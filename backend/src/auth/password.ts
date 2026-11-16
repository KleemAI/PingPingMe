import bcrypt from "bcryptjs";

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = async (pw: string, hash?: string | null) => (hash ? bcrypt.compare(pw, hash) : false);
