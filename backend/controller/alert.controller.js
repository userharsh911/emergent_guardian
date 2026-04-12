import sendPushNotification from "../libs/sendNotification.js";
import Alert from "../model/alert.model.js";
import Volunteer from "../model/volunteer.model.js";

export const createAlertController = async (req, res) => {
    try {
        const user = req.user;
        const { coordinates, description } = req.body;

        if (!coordinates) {
            return res.status(400).json({ success: false, message: "Coordinates are required" });
        }

        let latitude;
        let longitude;

        if (Array.isArray(coordinates)) {
            [longitude, latitude] = coordinates;
        } else {
            latitude = coordinates.latitude ?? coordinates.lat;
            longitude = coordinates.longitude ?? coordinates.lng;
        }

        latitude = Number(latitude);
        longitude = Number(longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return res.status(400).json({ success: false, message: "Invalid coordinates" });
        }

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
                alertId: emergencyAlert._id.toString()
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
}