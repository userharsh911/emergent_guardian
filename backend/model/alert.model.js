import mongoose, { Schema } from "mongoose"

const alertSchema = new mongoose.Schema({
    user_id:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true
    },
    location:{
        type:{
            type:String,
            enum:["Point"],
            required:true,
            default:"Point"
        },
        coordinates:{
            type:[Number],
            required:true
        }
    },
    description:{
        type:String,
    },
    image:{
        publicId:{
            type:String,
        },
        imageId:{
            type:String
        }
    },
    volunteer_id:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Volunteer"
    },
    mode:{
        type:String,
        enum:["Active","Cancelled","End","Alloted"]
    },
    volunteers:[{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Volunteer"
    }]
},{timestamps:true});

alertSchema.index({location:'2dsphere'});

const Alert = mongoose.model('Alert',alertSchema);
export default Alert;
