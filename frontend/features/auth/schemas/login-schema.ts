import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string({ message: "Vui long nhap email." })
    .trim()
    .email("Email khong hop le."),
  password: z
    .string({ message: "Vui long nhap mat khau." })
    .trim()
    .min(8, "Mat khau toi thieu 8 ky tu.")
});

export type LoginInput = z.infer<typeof loginSchema>;

