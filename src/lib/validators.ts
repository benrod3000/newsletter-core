import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  workspaceId: z.string().uuid().optional(),
});

export const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  workspace_name: z.string().min(1).max(100).optional(),
});

export const subscriberSchema = z.object({
  email: z.string().email("Invalid email address"),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  phone_number: z.string().max(30).optional(),
  date_of_birth: z.string().optional(),
  country: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const campaignSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  subject: z.string().min(1, "Subject is required").max(500),
  audience: z.string().default("confirmed"),
  editor_html: z.string().optional(),
  editor_css: z.string().nullable().optional(),
});

export const listSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(500).nullable().optional(),
  opt_in_type: z.enum(["single", "double"]).default("single"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type SubscriberInput = z.infer<typeof subscriberSchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;
export type ListInput = z.infer<typeof listSchema>;
