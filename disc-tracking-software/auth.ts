import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { db } from "@/database/drizzle"
import { usersTable } from "@/database/schema"
import { eq, sql } from "drizzle-orm"
import bcrypt from "bcryptjs"


export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
  },
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: '/sign-in',
  },

  providers: [
    CredentialsProvider({ 
        name: "Credentials",
        credentials: {
            email: { label: "Email", type: "email" },
            password: { label: "Password", type: "password" }
        },
        async authorize(credentials) {
        try {
            if(!credentials?.email || !credentials?.password || typeof credentials.email !== 'string' || typeof credentials.password !== 'string') {
                return null;
            }

            const email = credentials.email.trim().toLowerCase();
            const user = await db
              .select()
              .from(usersTable)
              .where(sql`lower(${usersTable.email}) = ${email}`)
              .limit(1);

            if(user.length === 0) {
                return null;
            }

            const isPasswordValid = await bcrypt.compare(credentials.password as string, user[0].password);

            if (!isPasswordValid) {
                return null;
            }

            return {
                id: user[0].id,
                email: user[0].email,
                name: user[0].full_name,
            };

        } catch (error) {
            console.error("Error during authorization:", error);
            return null;
        }
    }
  })],

  callbacks: 
  {
    async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                token.name = user.name;
            }

            return token;
        },

        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id as string;
                session.user.name = token.name as string;
            }
        
            return session;
        },
  },

});
