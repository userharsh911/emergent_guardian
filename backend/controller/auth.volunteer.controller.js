import { createJSONwebToken } from "../libs/jwt.js";
import { uploadVolunteerDocumentToCloudinary } from "../libs/cloudinary.js";
import { sendVolunteerOtpEmail } from "../libs/sendVolunteerOtpEmail.js";
import Volunteer from "../model/volunteer.model.js";
import bcryptjs from "bcryptjs"
import crypto from "crypto";

const OTP_MAX_SEND_PER_DAY = 3;
const OTP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OTP_EXPIRY_MINUTES = 10;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const escapeRegexValue = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findVolunteerByEmail = async (email) => {
    if (!email) return null;

    return Volunteer.findOne({
        email: {
            $regex: `^${escapeRegexValue(email)}$`,
            $options: "i",
        },
    });
};

const getOtpExpiryMinutes = () => {
    const parsedValue = Number(process.env.VOLUNTEER_OTP_EXPIRY_MINUTES);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
        return Math.floor(parsedValue);
    }

    return DEFAULT_OTP_EXPIRY_MINUTES;
};

const isVolunteerEmailOtpVerified = (volunteer) => volunteer?.email_otp_verified !== false;

const toVolunteerResponse = (volunteer) => {
    const volunteerResponse = volunteer?.toObject ? volunteer.toObject() : { ...volunteer };

    delete volunteerResponse.password;
    delete volunteerResponse.email_otp;

    return volunteerResponse;
};

const ensureOtpWindow = (volunteer) => {
    const nowMs = Date.now();
    const resetAtMs = volunteer?.email_otp_daily_reset_at
        ? new Date(volunteer.email_otp_daily_reset_at).getTime()
        : 0;

    if (!Number.isFinite(resetAtMs) || nowMs >= resetAtMs) {
        volunteer.email_otp_daily_count = 0;
        volunteer.email_otp_daily_reset_at = new Date(nowMs + OTP_WINDOW_MS);
    }
};

const getOtpLimitMeta = (volunteer) => {
    ensureOtpWindow(volunteer);

    const currentCount = Number(volunteer?.email_otp_daily_count || 0);
    const remaining = Math.max(0, OTP_MAX_SEND_PER_DAY - currentCount);

    if (remaining > 0) {
        return {
            limited: false,
            remaining,
        };
    }

    return {
        limited: true,
        remaining: 0,
        retryAt: volunteer?.email_otp_daily_reset_at,
    };
};

const issueVolunteerOtp = async (volunteer) => {
    const otpLimitMeta = getOtpLimitMeta(volunteer);

    if (otpLimitMeta.limited) {
        return {
            success: false,
            limited: true,
            retryAt: otpLimitMeta.retryAt,
            remaining: otpLimitMeta.remaining,
        };
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const otpExpiryMinutes = getOtpExpiryMinutes();

    volunteer.email_otp = otpCode;
    volunteer.email_otp_verified = false;
    volunteer.email_otp_expires_at = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);
    volunteer.email_otp_daily_count = Number(volunteer?.email_otp_daily_count || 0) + 1;

    await volunteer.save();

    await sendVolunteerOtpEmail({
        email: volunteer.email,
        otpCode,
        expiryMinutes: otpExpiryMinutes,
    });

    return {
        success: true,
        limited: false,
        expiryMinutes: otpExpiryMinutes,
        remaining: Math.max(0, OTP_MAX_SEND_PER_DAY - Number(volunteer?.email_otp_daily_count || 0)),
    };
};

const sendOtpLimitError = (res, retryAt) => {
    const retryAtLabel = retryAt ? new Date(retryAt).toLocaleString() : null;

    return res.status(429).json({
        success: false,
        message: retryAtLabel
            ? `OTP daily limit reached. Please try again after ${retryAtLabel}.`
            : "OTP daily limit reached. Please try again later.",
    });
};

const sendOtpRequiredResponse = (res, email, message, otpMeta) => {
    return res.status(200).json({
        success: true,
        requiresOtp: true,
        email,
        message,
        otpExpiresInMinutes: otpMeta?.expiryMinutes,
        otpSendRemaining: otpMeta?.remaining,
    });
};

export const applyVolunteerController = async(req,res)=>{
    try {
        const {fullname,email,password,phone,coordinates} = req.body;
        const normalizedEmail = normalizeEmail(email);

        if(!normalizedEmail || !password) {
            return res.status(400).json({success:false,message:"Email and password are required"});
        }

        const volunteerExist = await findVolunteerByEmail(normalizedEmail);
        if(volunteerExist) {
            const isVerify = await bcryptjs.compare(password, volunteerExist.password);
            if(!isVerify) return res.status(400).json({success:false,message:"Credentials are invalid"});

            if (isVolunteerEmailOtpVerified(volunteerExist)) {
                return res.status(409).json({success:false,message:"Email already exist"});
            }

            const otpMeta = await issueVolunteerOtp(volunteerExist).catch(() => null);
            if (!otpMeta) {
                return res.status(500).json({
                    success: false,
                    message: "Unable to send OTP right now. Please try again.",
                });
            }

            if (otpMeta.limited) {
                return sendOtpLimitError(res, otpMeta.retryAt);
            }

            return sendOtpRequiredResponse(
                res,
                normalizedEmail,
                "Account already exists but email is not verified. OTP sent again.",
                otpMeta
            );
        }

        const verificationDocumentFile = req.file;

        let normalizedCoordinates = coordinates;
        if (typeof normalizedCoordinates === "string") {
            try {
                normalizedCoordinates = JSON.parse(normalizedCoordinates);
            } catch (_error) {
                normalizedCoordinates = null;
            }
        }

        let latitude;
        let longitude;

        if (Array.isArray(normalizedCoordinates)) {
            [longitude, latitude] = normalizedCoordinates;
        } else {
            latitude = normalizedCoordinates?.latitude ?? normalizedCoordinates?.lat;
            longitude = normalizedCoordinates?.longitude ?? normalizedCoordinates?.lng;
        }

        latitude = Number(latitude);
        longitude = Number(longitude);

        if(!fullname || !phone || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return res.status(400).json({success:false,message:"All fields are required"});
        }

        if (!verificationDocumentFile?.buffer?.length) {
            return res.status(400).json({
                success: false,
                message: "Verification document is required",
            });
        }

        let uploadedDocument = null;
        try {
            uploadedDocument = await uploadVolunteerDocumentToCloudinary({
                fileBuffer: verificationDocumentFile.buffer,
                mimetype: verificationDocumentFile.mimetype,
                originalName: verificationDocumentFile.originalname,
            });
        } catch (uploadError) {
            return res.status(500).json({
                success: false,
                message: "Unable to upload volunteer document",
            });
        }

        const salt = await bcryptjs.genSalt(10);
        const hashedPassword = await bcryptjs.hash(password,salt);

        if(!hashedPassword) return res.status(500).json({success:false,message:"Internal server error"})

        const volunteer = Volunteer({
            fullname: fullname.trim(),
            email: normalizedEmail,
            password:hashedPassword,
            phone,
            location:{
                type:"Point",
                coordinates:[longitude, latitude]
            },
            verification_document: {
                publicId: uploadedDocument.publicId,
                url: uploadedDocument.url,
                format: uploadedDocument.format,
                resourceType: uploadedDocument.resourceType,
                bytes: uploadedDocument.bytes,
                originalName: verificationDocumentFile.originalname,
                mimeType: verificationDocumentFile.mimetype,
            },
            isverified: false,
            email_otp_verified: false,
        })

        const otpMeta = await issueVolunteerOtp(volunteer).catch(() => null);
        if (!otpMeta) {
            return res.status(500).json({
                success: false,
                message: "Volunteer account created but OTP could not be sent. Try login to resend OTP.",
            });
        }

        if (otpMeta.limited) {
            return sendOtpLimitError(res, otpMeta.retryAt);
        }

        return res.status(201).json({
            success: true,
            requiresOtp: true,
            email: normalizedEmail,
            message: "Volunteer account created. OTP sent to your email.",
            otpExpiresInMinutes: otpMeta.expiryMinutes,
            otpSendRemaining: otpMeta.remaining,
        });

    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const loginVolunteerController = async(req,res)=>{
    try {
        const {email,password} = req.body;
        const normalizedEmail = normalizeEmail(email);
        if(!normalizedEmail || !password) return res.status(400).json({success:false,message:"All fields are required"});

        const volunteer = await findVolunteerByEmail(normalizedEmail);
        if(!volunteer) return res.status(400).json({success:false,message:"Credentials are invalid"});

        const isVerify = await bcryptjs.compare(password,volunteer.password);
        if(!isVerify) return res.status(400).json({success:false,message:"Credentials are invalid"});

        if (!isVolunteerEmailOtpVerified(volunteer)) {
            const otpMeta = await issueVolunteerOtp(volunteer).catch(() => null);
            if (!otpMeta) {
                return res.status(500).json({
                    success: false,
                    message: "Unable to send OTP right now. Please try again.",
                });
            }

            if (otpMeta.limited) {
                return sendOtpLimitError(res, otpMeta.retryAt);
            }

            return sendOtpRequiredResponse(
                res,
                normalizedEmail,
                "Email is not verified. OTP sent to your email.",
                otpMeta
            );
        }

        const token = createJSONwebToken(normalizedEmail);
        const volunteerResponse = toVolunteerResponse(volunteer);

        res.send({success:true,token,volunteer: volunteerResponse});

    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const verifyVolunteerOtpController = async(req,res)=>{
    try {
        const { email, otp } = req.body;
        const normalizedEmail = normalizeEmail(email);
        const normalizedOtp = String(otp || "").trim();

        if (!normalizedEmail || !normalizedOtp) {
            return res.status(400).json({ success: false, message: "Email and OTP are required" });
        }

        const volunteer = await findVolunteerByEmail(normalizedEmail);
        if (!volunteer) {
            return res.status(400).json({ success: false, message: "Credentials are invalid" });
        }

        if (isVolunteerEmailOtpVerified(volunteer)) {
            const token = createJSONwebToken(normalizedEmail);
            return res.status(200).json({
                success: true,
                token,
                volunteer: toVolunteerResponse(volunteer),
                message: "Email already verified",
            });
        }

        const expiresAtMs = volunteer?.email_otp_expires_at
            ? new Date(volunteer.email_otp_expires_at).getTime()
            : 0;

        if (!volunteer?.email_otp || !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
            return res.status(400).json({
                success: false,
                message: "OTP has expired. Please request a new OTP.",
            });
        }

        if (String(volunteer.email_otp) !== normalizedOtp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        volunteer.email_otp_verified = true;
        volunteer.email_otp = null;
        volunteer.email_otp_expires_at = null;
        await volunteer.save();

        const token = createJSONwebToken(normalizedEmail);
        return res.status(200).json({
            success: true,
            token,
            volunteer: toVolunteerResponse(volunteer),
            message: "OTP verified successfully",
        });
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const resendVolunteerOtpController = async(req,res)=>{
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }

        const volunteer = await findVolunteerByEmail(normalizedEmail);
        if (!volunteer) {
            return res.status(400).json({ success: false, message: "Credentials are invalid" });
        }

        const isVerify = await bcryptjs.compare(password, volunteer.password);
        if (!isVerify) {
            return res.status(400).json({ success: false, message: "Credentials are invalid" });
        }

        if (isVolunteerEmailOtpVerified(volunteer)) {
            return res.status(409).json({
                success: false,
                message: "Email is already verified. Please login.",
            });
        }

        const otpMeta = await issueVolunteerOtp(volunteer).catch(() => null);
        if (!otpMeta) {
            return res.status(500).json({
                success: false,
                message: "Unable to send OTP right now. Please try again.",
            });
        }

        if (otpMeta.limited) {
            return sendOtpLimitError(res, otpMeta.retryAt);
        }

        return sendOtpRequiredResponse(
            res,
            normalizedEmail,
            "OTP sent to your email.",
            otpMeta
        );
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const getVolunteerController = async(req,res)=>{
    try {
        const volunteerResponse = toVolunteerResponse(req.volunteer);

        res.send({volunteer: volunteerResponse});
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}
