import axios from "axios";

export const crmHttp = axios.create({
  baseURL: "/api",
  timeout: 10_000,
  headers: {
    "Content-Type": "application/json"
  }
});

