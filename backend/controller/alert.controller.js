import sendPushNotification from "../libs/sendNotification.js";
import { expireStaleActiveAlerts, getAlertLifecycleMeta } from "../libs/alertLifecycle.js";
import { emitUserAlertRefresh, emitVolunteerAlertsRefresh } from "../libs/socket.js";
import Alert from "../model/alert.model.js";
import Volunteer from "../model/volunteer.model.js";

const NEARBY_DISTANCE_METERS = 500;

const parseCoordinates = (coordinates) => {
    let latitude;
    let longitude;

    if (Array.isArray(coordinates)) {
        [longitude, latitude] = coordinates;
    } else {
        latitude = coordinates?.latitude ?? coordinates?.lat;
        longitude = coordinates?.longitude ?? coordinates?.lng;
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
    const modeFilter = { $nin: ["Busy", "Alloted"] };

    try {
        return Volunteer.find({
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude],
                    },
                    $maxDistance: maxDistance,
                },
            },
            mode: modeFilter,
        })
            .select(selectFields)
            .lean();
    } catch (error) {
        console.log("volunteer geo query fallback", error?.message || error);

        const volunteers = await Volunteer.find({ mode: modeFilter })
            .select(selectFields)
            .lean();

        return volunteers.filter((volunteer) => {
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
        console.log("alert geo query fallback", error?.message || error);

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

const notifyAlertRealtime = (alertDoc, reason = "updated") => {
    const alertId = toIdString(alertDoc?._id);
    const userId = toIdString(alertDoc?.user_id);

    if (userId) {
        emitUserAlertRefresh(userId, { alertId, reason });
    }

    emitVolunteerAlertsRefresh({ alertId, reason });
};

const hydrateAlert = async (alertId) => {
    return Alert.findById(alertId)
        .populate("user_id", "fullname email phone")
        .populate("volunteer_id", "_id email phone mode location")
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

export const createAlertController = async (req, res) => {
    try {
        const user = req.user;
        const { coordinates, description } = req.body;

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

        const volunteers = await findNearbyVolunteers({
            latitude,
            longitude,
            maxDistance: NEARBY_DISTANCE_METERS,
            selectFields: "_id email phone location mode push_token",
        });

        const nearbyVolunteers = volunteers.map((volunteer) => ({
            _id: volunteer._id,
            email: volunteer.email,
            phone: volunteer.phone,
            mode: volunteer.mode,
            location: volunteer.location
        }));

        const emergencyAlert = new Alert({
            user_id: user._id,
            description: description ? description : null,
            location: {
                type: "Point",
                coordinates: [longitude, latitude]
            },
            mode: "Active",
            volunteers: volunteers.map((volunteer) => volunteer._id)
        });

        await emergencyAlert.save();

        notifyAlertRealtime(emergencyAlert, "created");

        const tokens = volunteers.map((volunteer) => volunteer.push_token).filter(Boolean);

        await sendPushNotification(
            tokens,
            "Nearby emergency detected",
            `Emergency available nearby, by ${user?.fullname || "a user"}`,
            {
                screen: "/(app)/(tabs)/(home)",
                alertId: emergencyAlert._id.toString(),
                description: description || "Emergency nearby",
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
        console.log("error while creating alert ", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getVolunteerNearbyAlertsController = async (req, res) => {
    try {
        const volunteer = req.volunteer;
        const parsedCoordinates = parseCoordinates(volunteer?.location?.coordinates);

        if (!parsedCoordinates) {
            return res.status(400).json({ success: false, message: "Volunteer coordinates are invalid" });
        }

        const { latitude, longitude } = parsedCoordinates;

        // MongoDB does not allow $near inside $or, so fetch and merge separately.
        const activeNearbyAlerts = await findActiveNearbyAlerts({
            latitude,
            longitude,
            maxDistance: NEARBY_DISTANCE_METERS,
        });

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
        console.log("error while getting volunteer nearby alerts ", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const volunteerSelectAlertController = async (req, res) => {
    try {
        const volunteer = req.volunteer;
        const { alertId } = req.body;

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
            .select("_id mode volunteer_id location")
            .lean();

        if (!alertToSelect) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        if (alertToSelect.mode !== "Active" || alertToSelect.volunteer_id) {
            return res.status(409).json({ success: false, message: "Alert is not available anymore" });
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

        const selectedAlert = await Alert.findOneAndUpdate(
            {
                _id: alertId,
                mode: "Active",
                volunteer_id: null,
            },
            {
                $set: {
                    volunteer_id: volunteer._id,
                    mode: "Alloted",
                },
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

        await Volunteer.findByIdAndUpdate(volunteer._id, { mode: "Alloted" });

        notifyAlertRealtime(selectedAlert, "alloted");

        return res.status(200).json({ success: true, alert: selectedAlert });
    } catch (error) {
        console.log("error while volunteer selecting alert ", error);
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
            .populate("volunteer_id", "_id email phone mode location")
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
            selectFields: "_id email phone location mode",
        });

        const nearbyVolunteersMap = new Map();

        dynamicNearbyVolunteers.forEach((volunteer) => {
            nearbyVolunteersMap.set(volunteer._id.toString(), volunteer);
        });

        if (alert?.volunteer_id?._id) {
            nearbyVolunteersMap.set(alert.volunteer_id._id.toString(), {
                _id: alert.volunteer_id._id,
                email: alert.volunteer_id.email,
                phone: alert.volunteer_id.phone,
                location: alert.volunteer_id.location,
                mode: alert.volunteer_id.mode,
            });
        }

        const nearbyVolunteers = Array.from(nearbyVolunteersMap.values());

        return res.status(200).json({
            success: true,
            alert,
            nearbyVolunteers,
            canHire: alert.mode === "Alloted" && Boolean(alert.volunteer_id),
            lifecycle: getAlertLifecycleMeta(alert),
        });
    } catch (error) {
        console.log("error while getting alert status ", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const updateAlertLiveLocationController = async (req, res) => {
    try {
        const { alertId } = req.params;
        const { coordinates } = req.body;

        if (!alertId) {
            return res.status(400).json({ success: false, message: "Alert id is required" });
        }

        const parsedCoordinates = parseCoordinates(coordinates);
        if (!parsedCoordinates) {
            return res.status(400).json({ success: false, message: "Invalid coordinates" });
        }

        const alert = await Alert.findOne({
            _id: alertId,
            user_id: req.user._id,
        });

        if (!alert) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        if (alert.mode === "Cancelled" || alert.mode === "End") {
            return res.status(409).json({
                success: false,
                message: "Alert is already closed. Location cannot be updated.",
            });
        }

        const { latitude, longitude } = parsedCoordinates;

        alert.location = {
            type: "Point",
            coordinates: [longitude, latitude],
        };

        await alert.save();

        const updatedAlert = await hydrateAlert(alert._id);
        notifyAlertRealtime(updatedAlert, "location-updated");

        return res.status(200).json({
            success: true,
            message: "Alert live location updated",
            alert: updatedAlert,
        });
    } catch (error) {
        console.log("error while updating alert live location ", error);

        if (error?.name === "CastError") {
            return res.status(400).json({ success: false, message: "Invalid alert id" });
        }

        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getUserAlertHistoryController = async (req, res) => {
    try {
        await expireStaleActiveAlerts({ userId: req.user._id });

        const alerts = await Alert.find({ user_id: req.user._id })
            .populate("volunteer_id", "_id email phone mode location")
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
        console.log("error while getting user alert history ", error);
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

        notifyAlertRealtime(updatedAlert, "cancelled");

        return res.status(200).json({
            success: true,
            message: "Alert cancelled successfully",
            alert: updatedAlert,
            releasedVolunteer,
        });
    } catch (error) {
        console.log("error while cancelling alert ", error);

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

        notifyAlertRealtime(updatedAlert, "ended");

        return res.status(200).json({
            success: true,
            message: "Alert ended successfully",
            alert: updatedAlert,
            releasedVolunteer,
        });

    } catch (error) {
        console.log("error while ending alert ", error);

        if (error?.name === "CastError") {
            return res.status(400).json({ success: false, message: "Invalid alert id" });
        }

        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};