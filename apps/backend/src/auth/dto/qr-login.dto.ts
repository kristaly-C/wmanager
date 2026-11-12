import { IsString, Matches, MaxLength } from "class-validator";




export class QrLoginDto{
    @IsString()
    @MaxLength(100)
    @Matches(/^WM-AUTH-[A-Za-z0-9_-]+$/, {
        message: 'Érvénytelen belépő QR-kód formátum'
    })
    qrToken!: string;
}