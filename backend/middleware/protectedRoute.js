import { verifyJSONwebToken } from "../libs/jwt.js";
import User from "../model/user.model.js";
import Volunteer from "../model/volunteer.model.js";

export const volunteerProtectedRoute = async(req,res,next)=>{
    try {
        const token = req.params?.token;
        console.log("vol token ")
        if(!token) res.status(402).send({success:false,message:"Unauthorized"})
        const {email} = verifyJSONwebToken(token);
        console.log("meil ",email)
        const volunteer = await Volunteer.findOne({email});
        if(!volunteer) res.status(402).send({success:false,message:"Unauthorized: Account not found"});

        req.volunteer = volunteer;
        console.log("end")
        next();
    } catch (error) {
        res.status(500).send({success:false,message:"Internal server error"});
        console.log("Error while verifying token ",error);
    }
}
export const userProtectedRoute = async(req,res,next)=>{
    try {
        const token = req.params?.token;
        console.log("token ",token)
        const as_guest = req.body?.as_guest;
        if(!token || as_guest) next();
        
        if(!token) res.status(402).send({success:false,message:"Unauthorized"})
        const {email} = verifyJSONwebToken(token);
    
        const user = await User.findOne({email});
        if(!user) res.status(402).send({success:false,message:"Unauthorized: Account not found"});

        req.user = user;
        next();
    } catch (error) {
        res.status(500).send({success:false,message:"Internal server error"});
        console.log("Error while verifying token ",error);
    }
}