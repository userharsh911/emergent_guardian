import Volunteer from "../model/volunteer.model.js";

export const volunteerSaveTokenController = async(req,res)=>{
    try {
        const { token: pushToken } = req.body;
        const userId = req.volunteer._id;

        if (!pushToken) {
            return res.status(400).json({ success: false, message: "Push token is required" });
        }

        await Volunteer.findByIdAndUpdate(userId, { push_token: pushToken });
        res.send({ success: true });
    } catch (error) {
        console.log("Error while save notification token ",error);
        return res.status(500).json({success:false,message:"Internal server error"})
    }
}

export const volunteerUpdateLocationController = async(req,res)=>{
    try {
        const { coordinates } = req.body;
        const userId = req.volunteer._id;

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
            return res.status(400).json({success:false,message:"Invalid coordinates"});
        }

        const volunteer = await Volunteer.findByIdAndUpdate(
            userId,
            {
                location: {
                    type: "Point",
                    coordinates: [longitude, latitude],
                },
            },
            { new: true }
        ).select("_id email phone location mode");

        return res.status(200).json({ success: true, volunteer });
    } catch (error) {
        console.log("Error while updating volunteer location ",error);
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}