import mongoose from "mongoose"

const volunteerSchema = new mongoose.Schema({
    fullname:{
        type:String,
        required:true,
        trim:true,
    },
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
        type:String,
        required:true,
    },
    mode:{
        type:String,
        enum:['Available','Busy','Call','Alloted'],
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
    },
    verification_document: {
        publicId: {
            type: String,
        },
        url: {
            type: String,
        },
        format: {
            type: String,
        },
        resourceType: {
            type: String,
        },
        bytes: {
            type: Number,
        },
        originalName: {
            type: String,
        },
        mimeType: {
            type: String,
        },
    },
    isverified: {
        type: Boolean,
        default: false,
        required: true,
    },
    push_token: {
        type: String,
        default: null
    },
    email_otp: {
        type: String,
        default: null,
    },
    email_otp_verified: {
        type: Boolean,
        default: true,
    },
    email_otp_expires_at: {
        type: Date,
        default: null,
    },
    email_otp_daily_count: {
        type: Number,
        default: 0,
    },
    email_otp_daily_reset_at: {
        type: Date,
        default: null,
    }
},{timestamps:true});

volunteerSchema.index({location:"2dsphere"});

const Volunteer = mongoose.model("Volunteer",volunteerSchema);
export default Volunteer;