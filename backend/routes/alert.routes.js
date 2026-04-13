import express from "express"
import {
	cancelAlertController,
	createAlertController,
	endAlertController,
	getAlertStatusController,
	getUserAlertHistoryController,
	getVolunteerNearbyAlertsController,
	hireVolunteerController,
	volunteerSelectAlertController,
} from "../controller/alert.controller.js";
import { userProtectedRoute, volunteerProtectedRoute } from "../middleware/protectedRoute.js";

const alertRouter = express.Router();

alertRouter.get('/volunteer/active/:token', volunteerProtectedRoute, getVolunteerNearbyAlertsController);
alertRouter.post('/volunteer/select/:token', volunteerProtectedRoute, volunteerSelectAlertController);
alertRouter.post('/volunteer/cancel/:token', volunteerProtectedRoute, cancelAlertController);

alertRouter.post('/status/:alertId/:token', userProtectedRoute, getAlertStatusController);
alertRouter.post('/status/:alertId', userProtectedRoute, getAlertStatusController);

alertRouter.post('/history/:token', userProtectedRoute, getUserAlertHistoryController);
alertRouter.post('/history', userProtectedRoute, getUserAlertHistoryController);

alertRouter.post('/cancel/:token', userProtectedRoute, cancelAlertController);
alertRouter.post('/cancel', userProtectedRoute, cancelAlertController);

alertRouter.post('/end/:token', userProtectedRoute, endAlertController);
alertRouter.post('/end', userProtectedRoute, endAlertController);

alertRouter.post('/hire/:token', userProtectedRoute, hireVolunteerController);
alertRouter.post('/hire', userProtectedRoute, hireVolunteerController);

alertRouter.post('/create/:token', userProtectedRoute, createAlertController);
alertRouter.post('/create', userProtectedRoute, createAlertController);

export default alertRouter