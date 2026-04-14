import sendPushNotification from "../libs/sendNotification.js";
import { expireStaleActiveAlerts, getAlertLifecycleMeta } from "../libs/alertLifecycle.js";
import { emitUserAlertRefresh, emitVolunteerAlertsRefresh } from "../libs/socket.js";
import Alert from "../model/alert.model.js";
import Volunteer from "../model/volunteer.model.js";
import { uploadAlertImageToCloudinary } from "../libs/cloudinary.js";

const NEARBY_DISTANCE_METERS = 500;

const isVolunteerModeEligibleForActiveAlerts = (mode) => {
    const normalizedMode = String(mode || "").trim().toLowerCase();
    return normalizedMode !== "busy" && normalizedMode !== "alloted";
};

const isVolunteerVerified = (volunteer) => Boolean(volunteer?.isverified);

const isVolunteerEligibleForActiveAlerts = (volunteer) => (
    isVolunteerVerified(volunteer) &&
    isVolunteerModeEligibleForActiveAlerts(volunteer?.mode)
);

const parseCoordinates = (coordinates) => {
    let normalizedCoordinates = coordinates;

    if (typeof normalizedCoordinates === "string") {
        try {
            normalizedCoordinates = JSON.parse(normalizedCoordinates);
        } catch (error) {
            return null;
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

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
    }

    return { latitude, longitude };
};

const calculateDistanceMeters = ({ from, to }) => {
    const earthRadius = 6371000;
    const toRadians = (value) => (value * Math.PI) / 180;

    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const dLat = lat2 - lat1;
    const dLon = toRadians(to.longitude - from.longitude);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
};

const findNearbyVolunteers = async ({ latitude, longitude, maxDistance = NEARBY_DISTANCE_METERS, selectFields }) => {
    try {
        const volunteers = await Volunteer.find({
            isverified: true,
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude],
                    },
                    $maxDistance: maxDistance,
                },
            },
        })
            .select(selectFields)
            .lean();

        return volunteers.filter((volunteer) => isVolunteerEligibleForActiveAlerts(volunteer));
    } catch (error) {

        const volunteers = await Volunteer.find({ isverified: true })
            .select(selectFields)
            .lean();

        return volunteers.filter((volunteer) => {
            if (!isVolunteerEligibleForActiveAlerts(volunteer)) return false;

            const volunteerCoordinates = parseCoordinates(volunteer?.location?.coordinates);
            if (!volunteerCoordinates) return false;

            const distanceMeters = calculateDistanceMeters({
                from: { latitude, longitude },
                to: volunteerCoordinates,
            });

            return distanceMeters <= maxDistance;
        });
    }
};

const findActiveNearbyAlerts = async ({ latitude, longitude, maxDistance = NEARBY_DISTANCE_METERS }) => {
    try {
        return Alert.find({
            mode: "Active",
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude],
                    },
                    $maxDistance: maxDistance,
                },
            },
        })
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "email phone location mode")
            .lean();
    } catch (error) {

        const activeAlerts = await Alert.find({ mode: "Active" })
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "email phone location mode")
            .lean();

        return activeAlerts.filter((alert) => {
            const alertCoordinates = parseCoordinates(alert?.location?.coordinates);
            if (!alertCoordinates) return false;

            const distanceMeters = calculateDistanceMeters({
                from: { latitude, longitude },
                to: alertCoordinates,
            });

            return distanceMeters <= maxDistance;
        });
    }
};

const toIdString = (value) => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (value?._id) return String(value._id);
    if (typeof value.toString === "function") return value.toString();
    return null;
};

const findVolunteerIdsNearCoordinates = async ({ latitude, longitude, maxDistance = NEARBY_DISTANCE_METERS }) => {
    try {
        const nearbyVolunteers = await Volunteer.find({
            isverified: true,
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude],
                    },
                    $maxDistance: maxDistance,
                },
            },
        })
            .select("_id mode isverified")
            .lean();

        return nearbyVolunteers
            .filter((volunteer) => isVolunteerEligibleForActiveAlerts(volunteer))
            .map((volunteer) => toIdString(volunteer?._id))
            .filter(Boolean);
    } catch (error) {

        const volunteers = await Volunteer.find({ isverified: true })
            .select("_id location mode isverified")
            .lean();

        return volunteers
            .filter((volunteer) => {
                if (!isVolunteerEligibleForActiveAlerts(volunteer)) return false;

                const volunteerCoordinates = parseCoordinates(volunteer?.location?.coordinates);
                if (!volunteerCoordinates) return false;

                const distanceMeters = calculateDistanceMeters({
                    from: { latitude, longitude },
                    to: volunteerCoordinates,
                });

                return distanceMeters <= maxDistance;
            })
            .map((volunteer) => toIdString(volunteer?._id))
            .filter(Boolean);
    }
};

const resolveRelevantVolunteerIdsForAlert = async (alertDoc) => {
    const volunteerIds = new Set();

    if (Array.isArray(alertDoc?.volunteers)) {
        alertDoc.volunteers.forEach((volunteerId) => {
            const normalizedVolunteerId = toIdString(volunteerId);
            if (normalizedVolunteerId) {
                volunteerIds.add(normalizedVolunteerId);
            }
        });
    }

    const assignedVolunteerId = toIdString(alertDoc?.volunteer_id);
    if (assignedVolunteerId) {
        volunteerIds.add(assignedVolunteerId);
    }

    const parsedAlertCoordinates = parseCoordinates(alertDoc?.location?.coordinates);
    if (parsedAlertCoordinates) {
        const nearbyVolunteerIds = await findVolunteerIdsNearCoordinates({
            latitude: parsedAlertCoordinates.latitude,
            longitude: parsedAlertCoordinates.longitude,
            maxDistance: NEARBY_DISTANCE_METERS,
        });

        nearbyVolunteerIds.forEach((volunteerId) => {
            volunteerIds.add(volunteerId);
        });
    }

    const rawVolunteerIds = Array.from(volunteerIds);
    if (!rawVolunteerIds.length) {
        return [];
    }

    const verifiedVolunteers = await Volunteer.find({
        _id: { $in: rawVolunteerIds },
        isverified: true,
    })
        .select("_id")
        .lean();

    return verifiedVolunteers
        .map((volunteer) => toIdString(volunteer?._id))
        .filter(Boolean);
};

const notifyAlertRealtime = async (alertDoc, reason = "updated", volunteerIds = []) => {
    const alertId = toIdString(alertDoc?._id);
    const userId = toIdString(alertDoc?.user_id);

    if (userId) {
        emitUserAlertRefresh(userId, { alertId, reason });
    }

    const explicitVolunteerIds = Array.isArray(volunteerIds)
        ? volunteerIds.map((volunteerId) => toIdString(volunteerId)).filter(Boolean)
        : [];

    const targetVolunteerIds = explicitVolunteerIds.length
        ? explicitVolunteerIds
        : await resolveRelevantVolunteerIdsForAlert(alertDoc);

    emitVolunteerAlertsRefresh({ alertId, reason }, targetVolunteerIds);
};

const hydrateAlert = async (alertId) => {
    return Alert.findById(alertId)
        .populate("user_id", "fullname email phone")
    .populate("volunteer_id", "_id fullname email phone mode location")
        .lean();
};

const releaseVolunteerAssignment = async (alertDoc) => {
    const assignedVolunteerId = alertDoc?.volunteer_id?._id || alertDoc?.volunteer_id;

    if (!assignedVolunteerId) {
        return null;
    }

    return Volunteer.findByIdAndUpdate(
        assignedVolunteerId,
        { mode: "Available" },
        { returnDocument: "after" }
    )
        .select("_id email phone mode location")
        .lean();
};

const hasVolunteerRespondedToAlert = (alertDoc, volunteerId) => {
    if (!Array.isArray(alertDoc?.volunteers)) return false;

    return alertDoc.volunteers.some((id) => String(id) === String(volunteerId));
};

export const createAlertController = async (req, res) => {
    try {
        const user = req.user;
        const { coordinates, description } = req.body;
        const alertImageFile = req.file;
        const normalizedDescription = typeof description === "string" ? description.trim() : "";

        if (!coordinates) {
            return res.status(400).json({ success: false, message: "Coordinates are required" });
        }

        const parsedCoordinates = parseCoordinates(coordinates);
        if (!parsedCoordinates) {
            return res.status(400).json({ success: false, message: "Invalid coordinates" });
        }

        await expireStaleActiveAlerts({ userId: user._id });

        const existingOpenAlert = await Alert.findOne({
            user_id: user._id,
            mode: { $in: ["Active", "Alloted"] },
        })
            .sort({ createdAt: -1 })
            .select("_id mode volunteer_id")
            .lean();

        if (existingOpenAlert) {
            return res.status(409).json({
                success: false,
                message:
                    existingOpenAlert.mode === "Alloted"
                        ? "Volunteer is already assigned on your current alert. Cancel it first."
                        : "You already have an active alert. Cancel it before sending another alert.",
                alert: existingOpenAlert,
            });
        }

        const { latitude, longitude } = parsedCoordinates;

        let uploadedImage = null;
        if (alertImageFile?.buffer?.length) {
            try {
                uploadedImage = await uploadAlertImageToCloudinary({
                    fileBuffer: alertImageFile.buffer,
                    mimetype: alertImageFile.mimetype,
                    userId: user?._id,
                });
            } catch (uploadError) {
                return res.status(500).json({
                    success: false,
                    message: "Unable to upload alert image right now",
                });
            }
        }

        const volunteers = await findNearbyVolunteers({
            latitude,
            longitude,
            maxDistance: NEARBY_DISTANCE_METERS,
            selectFields: "_id fullname email phone location mode push_token isverified",
        });

        const nearbyVolunteers = volunteers.map((volunteer) => ({
            _id: volunteer._id,
            fullname: volunteer.fullname,
            email: volunteer.email,
            phone: volunteer.phone,
            mode: volunteer.mode,
            location: volunteer.location
        }));

        const emergencyAlert = new Alert({
            user_id: user._id,
            description: normalizedDescription || null,
            location: {
                type: "Point",
                coordinates: [longitude, latitude]
            },
            image: uploadedImage
                ? {
                    publicId: uploadedImage.publicId,
                    imageId: uploadedImage.publicId,
                    url: uploadedImage.url,
                    width: uploadedImage.width,
                    height: uploadedImage.height,
                    format: uploadedImage.format,
                }
                : undefined,
            mode: "Active",
            volunteers: []
        });

        await emergencyAlert.save();

        await notifyAlertRealtime(
            emergencyAlert,
            "created",
            volunteers.map((volunteer) => volunteer._id)
        );

        const tokens = volunteers.map((volunteer) => volunteer.push_token).filter(Boolean);

        await sendPushNotification(
            tokens,
            "Nearby emergency detected",
            `Emergency available nearby, by ${user?.fullname || "a user"}`,
            {
                screen: "/(app)/(tabs)/(home)",
                alertId: emergencyAlert._id.toString(),
                description: normalizedDescription || "Emergency nearby",
                latitude,
                longitude,
            }
        );

        return res.status(201).json({
            success: true,
            message: "Alert sent successfully",
            alert: emergencyAlert,
            nearbyVolunteers,
            volunteerCount: volunteers.length,
            notifiedCount: tokens.length
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getVolunteerNearbyAlertsController = async (req, res) => {
    try {
        const volunteer = req.volunteer;

        if (!volunteer?.isverified) {
            return res.status(200).json({
                success: true,
                alerts: [],
                message: "Volunteer account is pending verification",
            });
        }

        const parsedCoordinates = parseCoordinates(volunteer?.location?.coordinates);

        if (!parsedCoordinates) {
            return res.status(400).json({ success: false, message: "Volunteer coordinates are invalid" });
        }

        const { latitude, longitude } = parsedCoordinates;
        const canReceiveFreshAlerts = isVolunteerModeEligibleForActiveAlerts(volunteer?.mode);

        // MongoDB does not allow $near inside $or, so fetch and merge separately.
        const activeNearbyAlerts = canReceiveFreshAlerts
            ? await findActiveNearbyAlerts({
                latitude,
                longitude,
                maxDistance: NEARBY_DISTANCE_METERS,
            })
            : [];

        const allotedForVolunteer = await Alert.find({
            mode: "Alloted",
            volunteer_id: volunteer._id,
        })
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "email phone location mode")
            .lean();

        const mergedAlertsMap = new Map();
        [...activeNearbyAlerts, ...allotedForVolunteer].forEach((alert) => {
            mergedAlertsMap.set(alert._id.toString(), alert);
        });

        const alerts = Array.from(mergedAlertsMap.values()).sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );

        return res.status(200).json({ success: true, alerts });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const volunteerSelectAlertController = async (req, res) => {
    try {
        const volunteer = req.volunteer;
        const { alertId } = req.body;

        if (!volunteer?.isverified) {
            return res.status(403).json({
                success: false,
                message: "Your account is not verified yet",
            });
        }

        if (!alertId) {
            return res.status(400).json({ success: false, message: "Alert id is required" });
        }

        const parsedCoordinates = parseCoordinates(volunteer?.location?.coordinates);
        if (!parsedCoordinates) {
            return res.status(400).json({ success: false, message: "Volunteer coordinates are invalid" });
        }

        const alreadyAssignedAlert = await Alert.findOne({
            mode: "Alloted",
            volunteer_id: volunteer._id,
            _id: { $ne: alertId },
        }).select("_id");

        if (alreadyAssignedAlert) {
            return res.status(409).json({ success: false, message: "You are already assigned to another alert" });
        }

        const { latitude, longitude } = parsedCoordinates;

        const alertToSelect = await Alert.findById(alertId)
            .select("_id mode volunteer_id location volunteers")
            .lean();

        if (!alertToSelect) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        if (alertToSelect.mode !== "Active") {
            return res.status(409).json({ success: false, message: "Alert is not accepting volunteer responses now" });
        }

        const parsedAlertCoordinates = parseCoordinates(alertToSelect?.location?.coordinates);
        if (!parsedAlertCoordinates) {
            return res.status(400).json({ success: false, message: "Alert coordinates are invalid" });
        }

        const distanceMeters = calculateDistanceMeters({
            from: { latitude, longitude },
            to: parsedAlertCoordinates,
        });

        if (distanceMeters > NEARBY_DISTANCE_METERS) {
            return res.status(403).json({
                success: false,
                message: "You can select alerts only within 500 meters",
            });
        }

        const isAlreadyResponded = hasVolunteerRespondedToAlert(alertToSelect, volunteer._id);

        const selectedAlert = await Alert.findOneAndUpdate(
            {
                _id: alertId,
                mode: "Active",
            },
            {
                $addToSet: {
                    volunteers: volunteer._id,
                },
            },
            { returnDocument: "after" }
        )
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "email phone location mode");

        if (!selectedAlert) {
            return res.status(409).json({ success: false, message: "Alert is not available anymore" });
        }

        await notifyAlertRealtime(selectedAlert, "volunteer-response");

        return res.status(200).json({
            success: true,
            message: isAlreadyResponded ? "Response already recorded" : "Response sent. Waiting for user to hire.",
            alert: selectedAlert,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const hireVolunteerController = async (req, res) => {
    try {
        const { alertId, volunteerId } = req.body;

        if (!alertId || !volunteerId) {
            return res.status(400).json({ success: false, message: "Alert id and volunteer id are required" });
        }

        const alertToHire = await Alert.findOne({
            _id: alertId,
            user_id: req.user._id,
        })
            .select("_id mode location volunteer_id volunteers")
            .lean();

        if (!alertToHire) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        if (alertToHire.mode !== "Active") {
            return res.status(409).json({ success: false, message: "Alert is not available for hiring" });
        }

        if (!hasVolunteerRespondedToAlert(alertToHire, volunteerId)) {
            return res.status(409).json({ success: false, message: "Volunteer has not responded on this alert yet" });
        }

        const volunteer = await Volunteer.findById(volunteerId)
            .select("_id email phone mode location isverified")
            .lean();

        if (!volunteer) {
            return res.status(404).json({ success: false, message: "Volunteer not found" });
        }

        if (!volunteer?.isverified) {
            return res.status(409).json({
                success: false,
                message: "Volunteer account is not verified",
            });
        }

        const volunteerBusyWithOtherAlert = await Alert.findOne({
            _id: { $ne: alertToHire._id },
            mode: "Alloted",
            volunteer_id: volunteer._id,
        })
            .select("_id")
            .lean();

        if (volunteerBusyWithOtherAlert) {
            return res.status(409).json({ success: false, message: "Volunteer is already hired on another alert" });
        }

        const parsedAlertCoordinates = parseCoordinates(alertToHire?.location?.coordinates);
        const parsedVolunteerCoordinates = parseCoordinates(volunteer?.location?.coordinates);

        if (!parsedAlertCoordinates || !parsedVolunteerCoordinates) {
            return res.status(400).json({ success: false, message: "Alert or volunteer coordinates are invalid" });
        }

        const distanceMeters = calculateDistanceMeters({
            from: parsedAlertCoordinates,
            to: parsedVolunteerCoordinates,
        });

        if (distanceMeters > NEARBY_DISTANCE_METERS) {
            return res.status(409).json({ success: false, message: "Volunteer is no longer within 500 meters" });
        }

        const hiredAlert = await Alert.findOneAndUpdate(
            {
                _id: alertToHire._id,
                user_id: req.user._id,
                mode: "Active",
            },
            {
                $set: {
                    mode: "Alloted",
                    volunteer_id: volunteer._id,
                },
                $addToSet: {
                    volunteers: volunteer._id,
                },
            },
            { returnDocument: "after" }
        )
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "_id fullname email phone mode location");

        if (!hiredAlert) {
            return res.status(409).json({ success: false, message: "Alert is not available for hiring" });
        }

        await Volunteer.findByIdAndUpdate(volunteer._id, { mode: "Alloted" });

        await notifyAlertRealtime(hiredAlert, "alloted");

        return res.status(200).json({
            success: true,
            message: "Volunteer hired successfully",
            alert: hiredAlert,
        });
    } catch (error) {

        if (error?.name === "CastError") {
            return res.status(400).json({ success: false, message: "Invalid alert id or volunteer id" });
        }

        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getAlertStatusController = async (req, res) => {
    try {
        const { alertId } = req.params;

        if (!alertId) {
            return res.status(400).json({ success: false, message: "Alert id is required" });
        }

        await expireStaleActiveAlerts({ userId: req.user._id });

        const alert = await Alert.findOne({
            _id: alertId,
            user_id: req.user._id,
        })
            .populate("volunteer_id", "_id fullname email phone mode location")
            .lean();

        if (!alert) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        const parsedAlertCoordinates = parseCoordinates(alert?.location?.coordinates);
        if (!parsedAlertCoordinates) {
            return res.status(400).json({ success: false, message: "Alert coordinates are invalid" });
        }

        const { latitude, longitude } = parsedAlertCoordinates;

        const dynamicNearbyVolunteers = await findNearbyVolunteers({
            latitude,
            longitude,
            maxDistance: NEARBY_DISTANCE_METERS,
            selectFields: "_id fullname email phone location mode isverified",
        });
        const respondedVolunteerIds = Array.isArray(alert?.volunteers) ? alert.volunteers : [];
        const respondedVolunteers = respondedVolunteerIds.length
            ? await Volunteer.find({ _id: { $in: respondedVolunteerIds }, isverified: true })
                .select("_id fullname email phone location mode isverified")
                .lean()
            : [];

        const nearbyVolunteersMap = new Map();

        dynamicNearbyVolunteers.forEach((volunteer) => {
            nearbyVolunteersMap.set(volunteer._id.toString(), volunteer);
        });

        respondedVolunteers.forEach((volunteer) => {
            nearbyVolunteersMap.set(volunteer._id.toString(), volunteer);
        });

        if (alert?.volunteer_id?._id) {
            nearbyVolunteersMap.set(alert.volunteer_id._id.toString(), {
                _id: alert.volunteer_id._id,
                fullname: alert.volunteer_id.fullname,
                email: alert.volunteer_id.email,
                phone: alert.volunteer_id.phone,
                location: alert.volunteer_id.location,
                mode: alert.volunteer_id.mode,
            });
        }

        const nearbyVolunteers = Array.from(nearbyVolunteersMap.values());
        const respondedVolunteersCount = respondedVolunteerIds.length;

        return res.status(200).json({
            success: true,
            alert,
            nearbyVolunteers,
            canHire: alert.mode === "Active" && respondedVolunteersCount > 0,
            lifecycle: getAlertLifecycleMeta(alert),
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getUserAlertHistoryController = async (req, res) => {
    try {
        await expireStaleActiveAlerts({ userId: req.user._id });

        const alerts = await Alert.find({ user_id: req.user._id })
            .populate("volunteer_id", "_id fullname email phone mode location")
            .sort({ createdAt: -1 })
            .lean();

        const alertsWithLifecycle = alerts.map((alert) => ({
            ...alert,
            lifecycle: getAlertLifecycleMeta(alert),
        }));

        return res.status(200).json({
            success: true,
            alerts: alertsWithLifecycle,
            totalAlerts: alertsWithLifecycle.length,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getVolunteerAlertHistoryController = async (req, res) => {
    try {
        const volunteerId = req.volunteer?._id;

        if (!volunteerId) {
            return res.status(400).json({ success: false, message: "Volunteer context is missing" });
        }

        const alerts = await Alert.find({
            $or: [
                { volunteer_id: volunteerId },
                { volunteers: volunteerId },
            ],
        })
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "_id fullname email phone mode location")
            .sort({ createdAt: -1 })
            .lean();

        const normalizedVolunteerId = String(volunteerId);

        const alertsWithInvolvement = alerts.map((alert) => {
            const assignedVolunteerId = toIdString(alert?.volunteer_id);
            const assignedToMe = assignedVolunteerId === normalizedVolunteerId;
            const respondedByMe = hasVolunteerRespondedToAlert(alert, volunteerId);

            return {
                ...alert,
                lifecycle: getAlertLifecycleMeta(alert),
                involvement: {
                    assignedToMe,
                    respondedByMe,
                },
            };
        });

        const assignedAlerts = alertsWithInvolvement.filter((alert) => alert?.involvement?.assignedToMe).length;
        const respondedAlerts = alertsWithInvolvement.filter((alert) => alert?.involvement?.respondedByMe).length;
        const completedAlerts = alertsWithInvolvement.filter(
            (alert) => alert?.mode === "End" && (alert?.involvement?.assignedToMe || alert?.involvement?.respondedByMe)
        ).length;
        const activeAlerts = alertsWithInvolvement.filter(
            (alert) => alert?.mode === "Active" || alert?.mode === "Alloted"
        ).length;

        return res.status(200).json({
            success: true,
            alerts: alertsWithInvolvement,
            summary: {
                totalAlerts: alertsWithInvolvement.length,
                assignedAlerts,
                respondedAlerts,
                completedAlerts,
                activeAlerts,
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const cancelAlertController = async (req, res) => {
    try {
        const user = req.user;
        const volunteer = req.volunteer;
        const { alertId, id } = req.body;
        const targetAlertId = alertId || id;

        if (!targetAlertId) {
            return res.status(400).json({ success: false, message: "Alert id is required" });
        }

        const alert = await Alert.findById(targetAlertId);

        if (!alert) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        const alertOwnerId = alert.user_id?.toString();
        const assignedVolunteerId = alert.volunteer_id?.toString();

        const isAlertOwner = Boolean(user) && String(user._id) === String(alertOwnerId);
        const isAssignedVolunteer =
            Boolean(volunteer) &&
            Boolean(assignedVolunteerId) &&
            String(volunteer._id) === String(assignedVolunteerId);

        if (!isAlertOwner && !isAssignedVolunteer) {
            return res.status(403).json({ success: false, message: "Not allowed to cancel this alert" });
        }

        if (alert.mode === "End") {
            return res.status(409).json({ success: false, message: "Completed alert cannot be cancelled" });
        }

        if (alert.mode === "Cancelled") {
            const existingAlert = await hydrateAlert(alert._id);
            return res.status(200).json({
                success: true,
                message: "Alert is already cancelled",
                alert: existingAlert,
            });
        }

        alert.mode = "Cancelled";
        await alert.save();

        const releasedVolunteer = await releaseVolunteerAssignment(alert);
        const updatedAlert = await hydrateAlert(alert._id);

        await notifyAlertRealtime(updatedAlert, "cancelled");

        return res.status(200).json({
            success: true,
            message: "Alert cancelled successfully",
            alert: updatedAlert,
            releasedVolunteer,
        });
    } catch (error) {

        if (error?.name === "CastError") {
            return res.status(400).json({ success: false, message: "Invalid alert id" });
        }

        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const endAlertController = async (req, res) => {
    try {
        const { alertId, id } = req.body;
        const targetAlertId = alertId || id;

        if (!targetAlertId) {
            return res.status(400).json({ success: false, message: "Alert id is required" });
        }

        const alert = await Alert.findOne({
            _id: targetAlertId,
            user_id: req.user._id,
        });

        if (!alert) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        if (alert.mode === "End") {
            const existingAlert = await hydrateAlert(alert._id);
            return res.status(200).json({
                success: true,
                message: "Alert is already completed",
                alert: existingAlert,
            });
        }

        if (alert.mode === "Cancelled") {
            return res.status(409).json({ success: false, message: "Cancelled alert cannot be ended" });
        }

        if (alert.mode !== "Alloted" || !alert.volunteer_id) {
            return res.status(409).json({
                success: false,
                message: "You can end alert only after volunteer is allotted",
            });
        }

        alert.mode = "End";
        await alert.save();

        const releasedVolunteer = await releaseVolunteerAssignment(alert);
        const updatedAlert = await hydrateAlert(alert._id);

        await notifyAlertRealtime(updatedAlert, "ended");

        return res.status(200).json({
            success: true,
            message: "Alert ended successfully",
            alert: updatedAlert,
            releasedVolunteer,
        });

    } catch (error) {

        if (error?.name === "CastError") {
            return res.status(400).json({ success: false, message: "Invalid alert id" });
        }

        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
