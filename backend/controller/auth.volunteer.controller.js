import { createJSONwebToken } from "../libs/jwt.js";
import Volunteer from "../model/volunteer.model.js";
import bcryptjs from "bcryptjs"

export const applyVolunteerController = async(req,res)=>{
    try {
        const {email,password,phone,coordinates} = req.body;

        if(!email || !password || !phone || !coordinates[0] || !coordinates[1]) res.status(400).send({success:false,message:"All fields are required"});

        const volunteerExist = await Volunteer.findOne({email});
        if(volunteerExist) res.status(409).send({success:false,message:"Email already exist"});

        const salt = await bcryptjs.genSalt(10);
        const hashedPassword = await bcryptjs.hash(password,salt);

        if(!hashedPassword) res.status(500).send({success:false,message:"Internal server error"})

        const volunteer = Volunteer({
            email,
            password:hashedPassword,
            phone,
            location:{
                type:"Point",
                coordinates
            }
        })

        await volunteer.save();

        const token = createJSONwebToken(email);

        res.status(201).send({success:true,token,volunteer});

    } catch (error) {
        console.log("error while applying as volunteer : ",error);
        res.status(500).send({success:false,message:"Internal server error"});
    }
}

export const loginVolunteerController = async(req,res)=>{
    try {
        const {email,password} = req.body;
        if(!email || !password) res.status(400).send({success:false,message:"All fields are required"});

        const volunteer = await Volunteer.findOne({email});
        if(!volunteer) res.status(400).send({success:false,message:"Credentials are invalid"});

        const isVerify = await bcryptjs.compare(password,volunteer.password);
        if(!isVerify) res.status(400).send({success:false,message:"Credentials are invalid"});

        const token = createJSONwebToken(email);
        
        delete volunteer.password;

        res.send({success:true,token,volunteer});

    } catch (error) {
        console.log("error while logging as volunteer : ",error);
        res.status(500).send({success:false,message:"Internal server error"});
    }
}

export const getVolunteerController = async(req,res)=>{
    try {
        console.log("send")
        const volunteer = req.volunteer;
        res.send({volunteer});
    } catch (error) {
        
    }
}