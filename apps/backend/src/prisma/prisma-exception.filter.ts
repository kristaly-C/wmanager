import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { Response } from "express";


@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
    catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
        const response = host.switchToHttp().getResponse<Response>();

        switch (exception.code) {
            case 'P2025': response.status(HttpStatus.NOT_FOUND).json({
                statusCode: HttpStatus.NOT_FOUND,
                message: 'Record not found'
            });
                return;
            case 'P2002': response.status(HttpStatus.CONFLICT).json({
                statusCode: HttpStatus.CONFLICT,
                message: 'A record with this value already exists',
            });
                return;
            default:
                response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                    message: 'Something went wrong',
                });
                return;
        }
    }
}