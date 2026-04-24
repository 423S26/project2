## ESOF 423 | Project Documentation
__________________________________________________
PROJECT OVERVIEW: 

The purpose of this project is to deliver an improved, all-encompassing disc golf tracker to help users find their frisbees more quickly and view their performance. To start the software, go to the website, create an account, and you will be redirected to the web application. From there, connect your tracked disc to your account on the web app and start playing!

This software includes: Add or remove tracked discs, view flight stats, record throws for better insights, and use tracking functionality to find discs more quickly. 

WANT TO REPORT A BUG OR SUGGEST A FEATURE?
Contact Us: moshernat@hotmail.com, wearewebtastic@gmail.com

USER TESTING SYNTHESIS:
https://docs.google.com/document/d/1xU23ADB9mdpHPeGq8i432nKedHnsL4S46RE8OTLQGqE/edit?usp=sharing


USER DOCS: 
* Interface incorporates WCAG AA styling to comply with ADA standards for web development.
* The color palette and typeface choice are an improvement from the original prototype. Improving readability by using a San Serif typeface (Inter) via Google Fonts for free-use purposes.
* Colors will not cause conflict with readability. WEBAIM.org https://webaim.org/resources/contrastchecker/ verifies this.

ACCESSING/USING THE APP:
# How to Use Disc Tracking Software

Follow these steps to get started tracking your disc golf throws.

### 1. Visit the Website
Go to:  
🌐 **https://disc-tracking-software.vercel.app/**

### 2. Sign In or Create an Account
Use the navigation at the top of the page to either:

- 🔑 **Sign in** with your existing account, or
- 🆕 **Create a new account**

### 3. Add & Manage Tracked Discs
Once logged in:
- Name and start a session
- Open the **Disc Actions** dropdown
- Add a new tracked disc by entering its name and connection number
- After adding, you can:
  - Sync the tracker
  - Switch between discs in your bag
  - Remove a disc if needed

### 4. Sync & Throw
With a disc selected and synced:

- Use the **live GPS distance preview** to help locate your disc after a throw
- Record throws using:
  - Built-in **accelerometer** data (auto-detects flight), or
  - **Manual stopwatch** mode (configurable in settings)

### 5. View Throw Analysis
After a throw, you’ll see:

- 📊 A detailed **flight path chart** showing curvature, distance, and direction
- Key metrics include but are not limited to:
  - Flight time
  - Distance
  - Average velocity
- Metrics can be changed to meters or feet, and can be chosen to be visible in the settings panel when desired

This data helps you understand disc behavior — perfect for choosing the right disc for long shots, hard right hooks, or windy conditions.

### 6. Save or Discard Throw Data
Not every throw is perfect (trees happen!). After viewing results:

- Click ** "Add Throw to Records"** to save the throw to your statistics, or
- Reset the timer and try again if you don’t want to log it
- Autosave is also available; users can delete their bad throws in the throw statistics page when desired

### 7. View Your Throw Statistics
Saved throws appear in the **User Throw Statistics** section, where you can:

- 📈 Analyze patterns in sessions over time
- 🔍 Compare different discs
- 🎯 Identify which disc performs best in specific situations

**Experiment freely** — the more data from sessions you collect, the better your on-course decisions will become.

### Note: all of the User Docs are provided on the main website page and the Dashboard of the webapp under "User guide".

### DEVELOPER DOCS: 

*Development tools: Microsoft Visual Studio Code; NextJS, TailwindCSS, TypeScript, PostgresQL, Timescale DB, PostGIS, Upstash Redis, Drizzle ORM.

* Landing page was created using Next.js with TailwindCSS and TypeScript for styling. Universal styles have been applied to meet WCAG AA standards. For the backend, a file structure was established with 2 groups to differentiate between the website and web app. This is shown using () in the naming of folders for organizational purposes.
* Components and other TSX styling are shown in PascalCase, with the  database using snake_case. 
* Configs for auth have been started, the .env.local file is being used to handle environmental variables as well as backend API keys. Additional API calls are being routed through the api folder in the project and the Golang server. **NOTE: Env files are NOT public and are shared privately between contributors**
* Backend Server has been done in Golang, which interacts as the port for the web application to interact with the devices and send data packets for the web app to process and serve to the end user. Recharts, a Next.js library, handles the visualization of the data in chart and card form.
* The embedded system will be written in C/C++ and flashed onto the physical device memory.
* Automated testing for frontend and backend is handled using V-test. Code Rabbit and Dependabot tests are shown on GitHub. Playwright testing is shown in the test_suite folder in the GitHub repository. 

HOW TO OBTAIN SOURCE CODE: This is shared through GitHub and downloading dependencies. To know which ones are to be downloaded, please refer to the project package.json file and run the command **"npm ci"**. This reads the package.json and package-lock.json and does a **c**lean **i**nstall. Do this instead of the general "npm install" as that will be much cleaner to work with for CI/CD pipelining.


Planned Directory Structure: As mentioned in the developer docs.
How to Build/Test: See Getting Started at the bottom of this Readme file.
How to release a version: Go to GitHub releases, draft a new release. This will create a new version to be tracked.
Bug tracker (See Issues in GitHub): Next.js Bugs/ Warnings

DEBUG CONSOLE: Is provided as an optional settings option on the dashboard, which can be used to troubleshoot hardware connections and
data pipelines with the hardware device.


## Links
__________________________________________________

UML: https://lucid.app/lucidchart/de78a944-3a2f-447c-8bc5-a37025b7ed87/edit?viewport_loc=-3217%2C-517%2C5539%2C1991%2C0_0&invitationId=inv_a76ce23f-0b78-49b6-ada1-e109331ec88d

Sprint/Portfolio Backlogs: https://docs.google.com/document/d/16ZOI3ZHT498dK0WAmcIgPP1SnBpY4iGB3s9eKXZxDik/edit?usp=sharing

## Tech Stack
__________________________________________________

* Frontend | Next.js, TailwindCSS
* Backend & DB | Go, PostgreSQL, Drizzle ORM, NeonDB
* Auth/Proxy | NextAuth.js
* Hardware | Flashed in C with GO server connection, Antenna integrated GPS module SKM52, XIAO RP2040, Disc Golf Driver


## Getting Started
__________________________________________________


To run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
