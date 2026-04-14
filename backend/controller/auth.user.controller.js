import bcryptjs from "bcryptjs";
import User from "../model/user.model.js";
import { generateUsername } from "../libs/username.js";
import {createJSONwebToken} from "../libs/jwt.js"

export const signupController = async(req,res)=>{
    try {
        const {email,password,phone,fullname} = req.body;
        if(!email || !password || !phone || !fullname) return res.status(400).json({success:false,message:"All fields are required"});

        const existingUser = await User.findOne({ email });
        if(existingUser) return res.status(409).json({success:false,message:"Email already exist"});

        const salt = await bcryptjs.genSalt(10);
        const hashedPassword = await bcryptjs.hash(password,salt);

        if(!hashedPassword) return res.status(500).json({success:false,message:"Internal server error"})

        const user = new User({
            email,
            password:hashedPassword,
            phone,
            fullname: fullname.trim(),
            as_guest:false
        })

        await user.save();

        const token = createJSONwebToken(email);

        const userResponse = user.toObject();
        delete userResponse.password;

        res.status(201).send({success:true,token,user:userResponse});


    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const loginController = async(req,res)=>{
    try {
        const {email,password} = req.body;
        if(!email || !password) return res.status(400).json({success:false,message:"All fields are required"});

        const user = await User.findOne({email});
        if(!user) return res.status(400).json({success:false,message:"Credentials are invalid"});

        if(user.as_guest) return res.status(403).json({success:false,message:"Please complete your account first"});

        const isVerify = await bcryptjs.compare(password,user.password);
        if(!isVerify) return res.status(400).json({success:false,message:"Invalid credentials"});

        const token = createJSONwebToken(email);

        const userResponse = user.toObject();
        delete userResponse.password;

        res.send({success:true,token,user:userResponse});

    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const loginAsGuestController = async(req,res)=>{
    try {
        const {as_guest,id,fullname,phone,email,password} = req.body;

        if(as_guest && !id){
            const user = new User({
                fullname: generateUsername("user"),
                as_guest:true,
            })

            await user.save();

            const userResponse = user.toObject();
            delete userResponse.password;

            return res.send({success:true,user:userResponse});
        }

        if(!id || !email || !password || !phone || !fullname){
            return res.status(400).json({success:false,message:"All fields are required"});
        }

        const guestUser = await User.findOne({_id:id, as_guest:true});
        if(!guestUser) return res.status(404).json({success:false,message:"Guest account not found"});

        const existUser = await User.findOne({email, _id:{$ne:id}});
        if(existUser) return res.status(409).json({success:false,message:"Account already exists"})

        const salt = await bcryptjs.genSalt(10);
        const hashedPassword = await bcryptjs.hash(password,salt);
        if(!hashedPassword) return res.status(500).json({success:false,message:"Internal server error"})

        guestUser.fullname = fullname;
        guestUser.phone = phone;
        guestUser.email = email;
        guestUser.password = hashedPassword;
        guestUser.as_guest = false;

        await guestUser.save();

        const token = createJSONwebToken(email);
        const userResponse = guestUser.toObject();
        delete userResponse.password;

        return res.send({
            success:true,
            message:"Guest account converted successfully",
            token,
            user:userResponse,
        });

    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }

}

export const getUserController = async(req,res)=>{
    try {
        const user = req.user;
        res.send({user})
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}

export const updateUserProfileController = async(req,res)=>{
    try {
        const user = req.user;

        if(user?.as_guest){
            return res.status(403).json({success:false,message:"Please complete guest account first"});
        }

        const { fullname, phone } = req.body;
        const updates = {};

        if(typeof fullname === "string" && fullname.trim()){
            updates.fullname = fullname.trim();
        }

        if(typeof phone === "string" && phone.trim()){
            updates.phone = phone.trim();
        }

        if(!Object.keys(updates).length){
            return res.status(400).json({success:false,message:"No valid fields to update"});
        }

        const updatedUser = await User.findByIdAndUpdate(
            user._id,
            { $set: updates },
            { returnDocument: "after" }
        ).select("-password");

        if(!updatedUser){
            return res.status(404).json({success:false,message:"User not found"});
        }

        return res.status(200).json({success:true,user:updatedUser});
    } catch (error) {
        return res.status(500).json({success:false,message:"Internal server error"});
    }
}
