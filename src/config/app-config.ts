import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "meta-crm",
  version: packageJson.version,
  copyright: `© ${currentYear}, meta-crm.`,
  meta: {
    title: "meta-crm — Instagram Follower Extractor",
    description: "Extract, track and validate Instagram followers for lead qualification.",
  },
};
