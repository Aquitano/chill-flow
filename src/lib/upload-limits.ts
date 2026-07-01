// Shared upload size caps. Kept free of server-only imports so both the admin client
// (presigned direct-to-R2 flow) and the multipart routes can enforce the same limits.
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
