import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { Response, Request } from "express";


@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(PrismaExceptionFilter.name);

    catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>()

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
            case 'P2003':
                if(request.method === 'DELETE') {
                    response.status(HttpStatus.CONFLICT).json({
                        statusCode: HttpStatus.CONFLICT,
                        message: 'This record is still referenced by other data and cannot be deleted',
                    });
                }else {
                    response.status(HttpStatus.BAD_REQUEST).json({
                        statusCode: HttpStatus.BAD_REQUEST,
                        message: 'A referenced record does not exist',
                    });
                }
                return;
            default:
                this.logger.error(`${exception.code}: ${exception.message}`, exception.stack);
                response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                    message: 'Something went wrong',
                });
                return;
        }
    }
}