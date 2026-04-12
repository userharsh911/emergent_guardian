import mongoose from "mongoose"

const userSchema = new mongoose.Schema({
    fullname:{
        type:String,
    },
    email:{
        type:String,
    },
    password:{
        type:String
    },
    as_guest:{
        type:Boolean,
        required:true,
        default:true
    }
},{timestamps:true});

const User = mongoose.model("User",userSchema);
export default User;