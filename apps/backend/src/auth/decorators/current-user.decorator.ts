import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Role } from "../../generated/prisma/enums";


export const CurrentUser = createParamDecorator(
    (data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        return request.user;
    },
);


export interface AuthUser {
    userId: string;
    email: string;
    role: Role;
}