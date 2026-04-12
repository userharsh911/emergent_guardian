import mongoose, { Schema } from "mongoose"

const alertSchema = new mongoose.Schema({
    userid:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User"
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
    }
},{timestamps:true});

alertSchema.index({location:'2dsphere'});

const Alert = mongoose.model('Alert',alertSchema);
export default Alert;
