import jwt from "jsonwebtoken"
import dotenv from "dotenv"

dotenv.config();

export const createJSONwebToken = (email)=>{
    const token = jwt.sign({email},process.env.JWT_SECRET,{expiresIn: '7d'});
    return token;
}

export const verifyJSONwebToken = (token)=>{
    return jwt.verify(token,process.env.JWT_SECRET);
}