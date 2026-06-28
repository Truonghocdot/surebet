import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string({ message: "Vui lòng nhập email." })
    .trim()
    .email("Email không hợp lệ."),
  password: z
    .string({ message: "Vui lòng nhập mật khẩu." })
    .trim()
    .min(8, "Mật khẩu tối thiểu 8 ký tự.")
});

export type LoginInput = z.infer<typeof loginSchema>;
