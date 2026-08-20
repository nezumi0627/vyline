export interface AuthTokenCredential {
    accessToken: string;
    refreshToken?: string;
    expire?: number;
}
export type AuthTokenInput = string | AuthTokenCredential;
export declare function parseAuthTokenInput(input: AuthTokenInput): AuthTokenCredential;
export declare function resolveLineAccessToken(token: string): string;
export declare function shouldUseLegyEncryptedAccess(token: string | undefined): boolean;
export declare function isJwt(value: string): boolean;
export declare function isPrimaryAccessToken(value: string): boolean;
export declare function createPrimaryAccessToken(authKey: string, now?: number): string;
