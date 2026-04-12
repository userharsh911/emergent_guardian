import mongoose from "mongoose"

const volunteerSchema = new mongoose.Schema({
    email:{
        type:String,
        required:true,
        unique:true,
    },
    password:{
        type:String,
        required:true,
    },
    phone:{
        type:Number,
        required:true,
    },
    mode:{
        type:String,
        enum:['Available','Busy','Call'],
        default:'Available',
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
    }
},{timestamps:true});

volunteerSchema.index({location:"2dsphere"});

const Volunteer = mongoose.model("Volunteer",volunteerSchema);
export default Volunteer;