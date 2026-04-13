import { createJSONwebToken } from "../libs/jwt.js";
import Volunteer from "../model/volunteer.model.js";
import bcryptjs from "bcryptjs"

export const applyVolunteerController = async(req,res)=>{
    try {
        const {fullname,email,password,phone,coordinates} = req.body;

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

        if(!fullname || !email || !password || !phone || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return res.status(400).json({success:false,message:"All fields are required"});
        }

        const volunteerExist = await Volunteer.findOne({email});
        if(volunteerExist) return res.status(409).json({success:false,message:"Email already exist"});

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
            }
        })

        await volunteer.save();

        const token = createJSONwebToken(email);

        res.status(201).send({success:true,token,volunteer});

    } catch (error) {
        console.log("error while applying as volunteer : ",error);
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
        console.log("error while logging as volunteer : ",error);
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