"use client";
import { createAuthClient } from "better-auth/react";
import { apiKeyClient } from "@better-auth/api-key/client";

export const authClient = createAuthClient({
  // No baseURL → uses window.location.origin, so the port doesn't matter.
  plugins: [apiKeyClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
