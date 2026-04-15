import { verifyJSONwebToken } from "../libs/jwt.js";
import User from "../model/user.model.js";
import Volunteer from "../model/volunteer.model.js";

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

export const volunteerProtectedRoute = async(req,res,next)=>{
    try {
        const token = req.params?.token;
        if(!token) return res.status(402).json({success:false,message:"Unauthorized"})

        const {email} = verifyJSONwebToken(token);
        const volunteer = await findVolunteerByEmail(email);
        if(!volunteer) return res.status(402).json({success:false,message:"Unauthorized: Account not found"});

        req.volunteer = volunteer;
        next();
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}
export const userProtectedRoute = async(req,res,next)=>{
    try {
        const token = req.params?.token;
        const as_guest = req.body?.as_guest;
        let user;
        if(!token && as_guest){
            user = await User.findOne({_id:as_guest});
            if(!user) return res.status(402).json({success:false,message:"Unauthorized: Invalid credentials"});
        }else{
            if(!token) return res.status(402).json({success:false,message:"Unauthorized"})
            const {email} = verifyJSONwebToken(token);
        
            user = await User.findOne({email});
            if(!user) return res.status(402).json({success:false,message:"Unauthorized: Account not found"});
        }
        req.user = user;
        next();
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}
