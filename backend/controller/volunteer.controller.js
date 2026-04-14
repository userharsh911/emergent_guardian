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

        const volunteerDoc = await Volunteer.findById(userId);
        if (!volunteerDoc) {
            return res.status(404).json({success:false,message:"Volunteer not found"});
        }

        volunteerDoc.location = {
            type: "Point",
            coordinates: [longitude, latitude],
        };

        volunteerDoc.markModified("location");
        await volunteerDoc.save();

        
        const volunteer = await Volunteer.findById(userId)
        .select("_id fullname email phone location mode isverified verification_document")
        .lean();
        
        if (!volunteer) {
            return res.status(404).json({success:false,message:"Volunteer not found"});
        }
        
        return res.status(200).json({ success: true, volunteer });
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const volunteerUpdateProfileController = async(req,res)=>{
    try {
        const userId = req.volunteer._id;
        const { fullname, phone } = req.body;
        const updates = {};

        if (typeof fullname === "string" && fullname.trim()) {
            updates.fullname = fullname.trim();
        }

        if (phone !== undefined && phone !== null && String(phone).trim()) {
            updates.phone = String(phone).trim();
        }

        if (!Object.keys(updates).length) {
            return res.status(400).json({success:false,message:"No valid fields to update"});
        }

        const volunteer = await Volunteer.findByIdAndUpdate(
            userId,
            { $set: updates },
            { returnDocument: "after" }
        ).select("_id fullname email phone location mode isverified verification_document");

        if (!volunteer) {
            return res.status(404).json({success:false,message:"Volunteer not found"});
        }

        return res.status(200).json({ success: true, volunteer });
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}
