import express from "express"
import { getUserController, loginAsGuestController, loginController, signupController } from "../controller/auth.user.controller.js";
import { userProtectedRoute } from "../middleware/protectedRoute.js";

const userAuthRouter = express.Router();

userAuthRouter.post('/signup',signupController);
userAuthRouter.post('/login',loginController);
userAuthRouter.post('/guest',loginAsGuestController);
userAuthRouter.get('/user/:token',userProtectedRoute,getUserController);

export default userAuthRouter;