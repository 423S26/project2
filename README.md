## ESOF 423 | Project Documentation
__________________________________________________
PROJECT OVERVIEW: 

The purpose of this project is to deliver an improved, all-encompassing disc golf tracker to help users find their frisbees quicker and view their performance. To start the software, simply go to the website, create an account, and you will be redirected to the web application. From there connect your tracked disc to your account on the web app and start playing!

This software includes: Add or remove tracked discs, view flight stats, record throws for better insights, and use tracking functionality to find discs quicker. 

WANT TO REPORT A BUG OR SUGGEST A FEATURE?
Contact Us: moshernat@hotmail.com, wearewebtastic@gmail.com


USER DOCS: 
* Interface incorporates WCAG AA styling to comply with ADA standards for web development.
* The color palette and typeface choice are an improvement from the original prototype. Improving readability by using a San Serif typeface (Inter) via Google Fonts for free-use purposes.
* Colors will not cause conflict with readability. This is verified by WEBAIM.org https://webaim.org/resources/contrastchecker/.

ACCESSING/USING THE APP:
* Go to the website: https://disc-tracking-software.vercel.app/
* Either "Sign-in" or "Create an account" by following the navigation at the top of the webpage.
* Once logged in, you can add the tracked disc under the disc actions drop-down. Once you add your disc credentials, you can sync the tracker and start playing.
* Once a disc is synced, you have multiple options for what to do with it within the dropdown options; You can delete the disc if needed, change it out for an alternative tracked disc on their profile, and sync if desired.
* Now that you've synced and decided what disc to play, you can preview the live GPS distance tracker to help you find the disc once thrown!
* Another fun feature is the ability to receive data based on your throws, either using the tracker's accelerometer built into the device or by recording the flight time manually if preferred. This provides a detailed flight chart so you can view the data and understand how your throws are traveling.
* This is useful for many reasons because you can determine what discs are best for the situation, for example, throwing far shots, or a hard right hook. Making judgment calls for the correct disc to throw in a competitive game can be hard. By experimenting with the tool, you will have all the data you need to make those crucial game-breaking throws.
* Data collection: Once you make a throw, you can decide whether or not to add it to your throw statistics. Everyone makes mistakes in Disc golf, if a player tees off, nailing a tree in the first 5-10 feet, odds are they don't want that to impact their flight statistics. Once a throw is made, or the  manual timer is done being used for the throw, the player previews their throw information, flight chart, velocity, distance, etc. They are then prompted as to whether or not they want to add the throw to their statistical records by clicking the "Add Throw to Records" button or resetting by either throwing again or resetting the manual timer.
* Your throw data will be added to the "User Throw Statistics" portion of the application, where you can view, analyse, and compare data so you can find the optimal disc to use for any situation on the course. 


DEVELOPER DOCS: 

* Landing page was created using Next.js with TailwindCSS and TypeScript for styling. Universal styles have been applied to meet WCAG AA standards. For the backend, a file structure was established with 2 groups to differentiate between the website and web app. This is shown using () in the naming of folders for organizational purposes.
* Components and other TSX styling are shown in PascalCase, with the  database using snake_case. 
* Configs for auth have been started, the .env.local file is being used to handle environmental variables as well as backend API keys. Additional API calls are being routed through the api folder in the project. **NOTE: Env files are NOT public and are shared privately between contributors**
* Backend Server will be done in GO, this interacts as the port for the web application to interact with the devices and send data packets for the web app to process and serve to the end user. Recharts, a Next.js library, handles the visualization of the data in chart and card form.
* The embedded system will be written in C/C++ and flashed onto the physical device memory.

HOW TO OBTAIN SOURCE CODE: This is shared through GitHub and downloading dependencies. To know which ones are to be downloaded, please refer to the project package.json file and run the command **"npm ci"**. This reads the package.json and package-lock.json and does a **c**lean **i**nstall. Do this instead of the general "npm install" as that will be much cleaner to work with for CI/CD pipelining.


Planned Directory Structure: As mentioned in the developer docs.
How to Build/Test: See Getting Started in bottom of this Readme file.
How to release a version: Go to GitHub releases, draft a new release. This will create a new version to be tracked.
Bug tracker (See Issues in GitHub): Next.js Bugs/ Warnings


## Links
__________________________________________________

UML: https://lucid.app/lucidchart/de78a944-3a2f-447c-8bc5-a37025b7ed87/edit?viewport_loc=-3217%2C-517%2C5539%2C1991%2C0_0&invitationId=inv_a76ce23f-0b78-49b6-ada1-e109331ec88d

Sprint Backlogs: https://docs.google.com/document/d/16ZOI3ZHT498dK0WAmcIgPP1SnBpY4iGB3s9eKXZxDik/edit?usp=sharing

## Tech Stack
__________________________________________________

* Frontend | Next.js, TailwindCSS
* Backend & DB | Go, PostgreSQL with Drizzle ORM, NeonDB, C
* Auth/Proxy | NextAuth.js
* Hardware | Antenna integrated GPS module SKM52, XIAO RP2040, Disc Golf Driver


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
