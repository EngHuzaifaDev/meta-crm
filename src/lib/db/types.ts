import type { ObjectId } from "mongodb";

export interface IUser {
  _id: string | ObjectId;
  name: string;
  email: string;
  emailVerified: boolean;
  avatar?: string;
  role: number;
  industry?: string;
  services: string[];
  createdAt: Date;
  updatedAt: Date;
}
