import { createJSONwebToken } from "../libs/jwt.js";
import { uploadVolunteerDocumentToCloudinary } from "../libs/cloudinary.js";
import Volunteer from "../model/volunteer.model.js";
import bcryptjs from "bcryptjs"

export const applyVolunteerController = async(req,res)=>{
    try {
        const {fullname,email,password,phone,coordinates} = req.body;
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

        if(!fullname || !email || !password || !phone || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return res.status(400).json({success:false,message:"All fields are required"});
        }

        if (!verificationDocumentFile?.buffer?.length) {
            return res.status(400).json({
                success: false,
                message: "Verification document is required",
            });
        }

        const volunteerExist = await Volunteer.findOne({email});
        if(volunteerExist) return res.status(409).json({success:false,message:"Email already exist"});

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
            email,
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
        })

        await volunteer.save();

        const token = createJSONwebToken(email);

        const volunteerResponse = volunteer.toObject();
        delete volunteerResponse.password;

        res.status(201).send({success:true,token,volunteer: volunteerResponse});

    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const loginVolunteerController = async(req,res)=>{
    try {
        const {email,password} = req.body;
        if(!email || !password) return res.status(400).json({success:false,message:"All fields are required"});

        const volunteer = await Volunteer.findOne({email});
        if(!volunteer) return res.status(400).json({success:false,message:"Credentials are invalid"});

        const isVerify = await bcryptjs.compare(password,volunteer.password);
        if(!isVerify) return res.status(400).json({success:false,message:"Credentials are invalid"});

        const token = createJSONwebToken(email);
        const volunteerResponse = volunteer.toObject();
        delete volunteerResponse.password;

        res.send({success:true,token,volunteer: volunteerResponse});

    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const getVolunteerController = async(req,res)=>{
    try {
        const volunteerResponse = req.volunteer.toObject();
        delete volunteerResponse.password;

        res.send({volunteer: volunteerResponse});
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}
