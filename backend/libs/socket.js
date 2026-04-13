import { Server } from "socket.io";
import { verifyJSONwebToken } from "./jwt.js";
import User from "../model/user.model.js";
import Volunteer from "../model/volunteer.model.js";

let ioInstance = null;

const toIdString = (value) => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (value?._id) return String(value._id);
    if (typeof value.toString === "function") return value.toString();
    return null;
};

const resolveSocketIdentity = async (socket) => {
    const auth = socket.handshake?.auth || {};
    const query = socket.handshake?.query || {};

    const role = auth.role || query.role;
    const token = auth.token || query.token;
    const guestId = auth.guestId || query.guestId || auth.as_guest || query.as_guest;

    if (role === "user") {
        if (token) {
            const { email } = verifyJSONwebToken(token);
            const user = await User.findOne({ email }).select("_id as_guest").lean();
            if (!user) throw new Error("Unauthorized user socket");

            return {
                role: "user",
                userId: toIdString(user._id),
                isGuest: Boolean(user.as_guest),
            };
        }

        if (guestId) {
            const user = await User.findById(guestId).select("_id as_guest").lean();
            if (!user) throw new Error("Unauthorized guest socket");

            return {
                role: "user",
                userId: toIdString(user._id),
                isGuest: Boolean(user.as_guest),
            };
        }

        throw new Error("Missing user socket auth");
    }

    if (role === "volunteer") {
        if (!token) throw new Error("Missing volunteer token");

        const { email } = verifyJSONwebToken(token);
        const volunteer = await Volunteer.findOne({ email }).select("_id").lean();
        if (!volunteer) throw new Error("Unauthorized volunteer socket");

        return {
            role: "volunteer",
            volunteerId: toIdString(volunteer._id),
        };
    }

    throw new Error("Invalid socket role");
};

export const initSocketServer = (httpServer) => {
    ioInstance = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });

    ioInstance.use(async (socket, next) => {
        try {
            const identity = await resolveSocketIdentity(socket);
            socket.data = identity;
            return next();
        } catch (error) {
            return next(new Error("Unauthorized socket connection"));
        }
    });

    ioInstance.on("connection", (socket) => {
        if (socket.data?.role === "user") {
            socket.join(`user:${socket.data.userId}`);
        }

        if (socket.data?.role === "volunteer") {
            socket.join(`volunteer:${socket.data.volunteerId}`);
        }

        socket.emit("socket:ready", {
            role: socket.data?.role,
            userId: socket.data?.userId || null,
            volunteerId: socket.data?.volunteerId || null,
        });
    });

    return ioInstance;
};

export const getSocketServer = () => ioInstance;

export const emitUserAlertRefresh = (userId, payload = {}) => {
    if (!ioInstance || !userId) return;

    ioInstance.to(`user:${toIdString(userId)}`).emit("user-alert:refresh", {
        ...payload,
        userId: toIdString(userId),
    });
};

export const emitVolunteerAlertsRefresh = (payload = {}, volunteerIds = []) => {
    if (!ioInstance) return;

    const targetVolunteerIds = Array.from(
        new Set((volunteerIds || []).map((id) => toIdString(id)).filter(Boolean))
    );

    if (!targetVolunteerIds.length) return;

    targetVolunteerIds.forEach((volunteerId) => {
        ioInstance.to(`volunteer:${volunteerId}`).emit("volunteer-alerts:refresh", {
            ...payload,
            volunteerId,
        });
    });
};
