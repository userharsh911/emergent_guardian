import sendPushNotification from "../libs/sendNotification.js";
import Alert from "../model/alert.model.js";
import Volunteer from "../model/volunteer.model.js";

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

        const { latitude, longitude } = parsedCoordinates;

        const volunteers = await Volunteer.find({
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude]
                    },
                    $maxDistance: 500 // meters
                }
            },
            mode: { $nin: ["Busy", "Alloted"] }
        }).select("_id email phone location mode push_token")

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

        const alerts = await Alert.find({
            $or: [
                {
                    mode: "Active",
                    location: {
                        $nearSphere: {
                            $geometry: {
                                type: "Point",
                                coordinates: [longitude, latitude],
                            },
                            $maxDistance: 500,
                        },
                    },
                },
                {
                    mode: "Alloted",
                    volunteer_id: volunteer._id,
                },
            ],
        })
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "email phone location mode")
            .sort({ createdAt: -1 })
            .lean();

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

        const { latitude, longitude } = parsedCoordinates;

        const selectedAlert = await Alert.findOneAndUpdate(
            {
                _id: alertId,
                mode: "Active",
                volunteer_id: null,
                location: {
                    $nearSphere: {
                        $geometry: {
                            type: "Point",
                            coordinates: [longitude, latitude],
                        },
                        $maxDistance: 500,
                    },
                },
            },
            {
                $set: {
                    volunteer_id: volunteer._id,
                    mode: "Alloted",
                },
            },
            { new: true }
        )
            .populate("user_id", "fullname email phone")
            .populate("volunteer_id", "email phone location mode");

        if (!selectedAlert) {
            return res.status(409).json({ success: false, message: "Alert is not available anymore" });
        }

        await Volunteer.findByIdAndUpdate(volunteer._id, { mode: "Alloted" });

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

        const alert = await Alert.findOne({
            _id: alertId,
            user_id: req.user._id,
        })
            .populate("volunteer_id", "_id email phone mode location")
            .lean();

        if (!alert) {
            return res.status(404).json({ success: false, message: "Alert not found" });
        }

        const nearbyVolunteers = await Volunteer.find({ _id: { $in: alert.volunteers || [] } })
            .select("_id email phone location mode")
            .lean();

        return res.status(200).json({
            success: true,
            alert,
            nearbyVolunteers,
            canHire: alert.mode === "Alloted" && Boolean(alert.volunteer_id),
        });
    } catch (error) {
        console.log("error while getting alert status ", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};