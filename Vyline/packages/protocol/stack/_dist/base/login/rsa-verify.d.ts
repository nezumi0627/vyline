import type { RSAKey } from "@vyline/line-types";
export declare function getRSACrypto(message: string, json: RSAKey): {
    keyname: string;
    credentials: any;
    message: string;
};
