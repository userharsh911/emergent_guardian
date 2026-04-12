import bcryptjs from "bcryptjs";
import User from "../model/user.model.js";
import { generateUsername } from "../libs/username.js";
import {createJSONwebToken} from "../libs/jwt.js"

export const signupController = async(req,res)=>{
    try {
        const {email,password,phone} = req.body;
        if(!email || !password || !phone) res.status(400).send({success:false,message:"All fields are required"});

        const salt = await bcryptjs.genSalt(10);
        const hashedPassword = await bcryptjs.hash(password,salt);

        if(!hashedPassword) res.status(500).send({success:false,message:"Internal server error"})

        const user = User({
            email,
            password:hashedPassword,
            phone,
            as_guest:false
        })

        await user.save();

        const token = createJSONwebToken(email);

        delete user.password;

        res.status(201).send({success:true,token,user});


    } catch (error) {
        console.log("error while creating an account : ",error);
        res.status(500).send({success:false,message:"Internal server error"});
    }
}

export const loginController = async(req,res)=>{
    try {
        const {email,password} = req.body;
        if(!email || !password) res.status(400).send({success:false,message:"All fields are required"});

        const user = await User.findOne({email});
        if(!user) res.status(400).send({success:false,message:"Credentials are invalid"});

        const isVerify = await bcryptjs.compare(password,user.password);
        if(!isVerify) res.status(400).send({success:false,message:"Credentials are invalid"});

        const token = createJSONwebToken(email);
        
        delete user.password;

        res.send({success:true,token,user});

    } catch (error) {
        console.log("error while logging : ",error);
        res.status(500).send({success:false,message:"Internal server error"});
    }
}

export const loginAsGuestController = async(req,res)=>{
    try {
        const {as_guest} = req.body;
        if(!as_guest.toString()) res.status(400).send({success:false,message:"All fields are required"});

        if(as_guest && !req.body?.id){
            const user = User({
                fullname: generateUsername("user")
            })
            if(!user) res.status(400).send({success:false,message:"Credentials are invalid"});        
    
            await user.save();
            res.send({success:true,user});
        }else{
            const {id,fullname,phone,email,password} = req.body;
            if(!email || !password || !phone || !fullname) res.status(400).send({success:false,message:"All fields are required"});

            const existUser = await User.findOne({email});
            if(existUser) res.status(400).send({success:false,message:"Account Already exists"})

            const salt = await bcryptjs.genSalt(10);
            const hashedPassword = await bcryptjs.hash(password,salt);
            if(!hashedPassword) res.status(500).send({success:false,message:"Internal server error"})

            const user = await User.findOneAndUpdate({id},{
                fullname,
                phone,
                email,
                password:hashedPassword,
                as_guest:false
            },{new:true})
            if(!user) res.status(400).send({success:false,message:"Bad request"});

            delete user.password;
            res.send({success:true,user});
        }

    } catch (error) {
        console.log("error while logging as guest : ",error);
        res.status(500).send({success:false,message:"Internal server error"});
    }

}

export const getUserController = async(req,res)=>{
    try {
        const user = req.user;
        res.send({user})
    } catch (error) {
        
    }
}
