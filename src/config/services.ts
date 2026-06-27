// lib/config/services.ts
export interface ServiceItem {
  id: string;      // slug
  name: string;
  description: string;
}

// lib/config/services.ts

export interface ServiceItem {
  id: string;      // slug
  name: string;
  description: string;
}

export const SERVICES: ServiceItem[] = [
  // ============ STRATEGY & DISCOVERY ============
  {
    id: "brand-strategy",
    name: "Brand Strategy & Positioning",
    description: "Comprehensive market research, competitor analysis, and brand positioning to define your unique value proposition, voice, and long-term market identity."
  },
  {
    id: "market-research",
    name: "Market & Audience Analytics",
    description: "Deep-dive quantitative and qualitative research to map customer personas, purchase intent, and market gaps, ensuring every decision is backed by hard data."
  },

  // ============ ATTRACT (MARKETING) ============
  {
    id: "seo",
    name: "Search Engine Optimization (SEO)",
    description: "Holistic on-page, off-page, and technical SEO strategies designed to boost organic rankings, increase domain authority, and drive a consistent stream of high-intent traffic."
  },
  {
    id: "local-seo",
    name: "Local SEO & Google Maps Optimization",
    description: "Hyper-localized strategies including Google Business Profile management, local citation building, and geo-targeted content to dominate 'near me' searches and local pack results."
  },
  {
    id: "ppc-management",
    name: "PPC & Paid Search Advertising",
    description: "Full-funnel paid media management across Google Ads and Bing, utilizing AI-driven bidding, rigorous A/B testing, and audience segmentation to maximize ROAS and lower CAC."
  },
  {
    id: "social-media-management",
    name: "Social Media Management & Growth",
    description: "Organic social strategy, content calendars, community engagement, and viral growth hacking across Instagram, LinkedIn, TikTok, and Facebook to build active brand communities."
  },
  {
    id: "paid-social",
    name: "Paid Social Advertising",
    description: "Advanced campaign orchestration on Meta, TikTok, LinkedIn, and Pinterest using custom lookalike audiences, dynamic retargeting, and creative testing to scale acquisition profitably."
  },
  {
    id: "content-marketing",
    name: "Content Marketing & Copywriting",
    description: "Strategic creation of SEO-driven blog posts, whitepapers, case studies, and long-form sales copy that educates prospects, builds thought leadership, and drives conversions."
  },
  {
    id: "video-production",
    name: "Video Marketing & Motion Graphics",
    description: "End-to-end production of high-impact explainer videos, product demos, brand stories, and short-form social reels optimized for maximum engagement and retention."
  },
  {
    id: "influencer-marketing",
    name: "Influencer & Creator Partnerships",
    description: "Strategic identification, outreach, and campaign management with micro and macro influencers to leverage authentic trust, expand reach, and generate UGC at scale."
  },
  {
    id: "pr",
    name: "Public Relations & Digital PR",
    description: "Media pitching, press release distribution, and journalist relationship management to secure high-authority backlinks, featured articles, and positive brand coverage."
  },

  // ============ CONVERT (CRO & EMAIL) ============
  {
    id: "conversion-optimization",
    name: "Conversion Rate Optimization (CRO)",
    description: "Data-driven UX audits, heatmap analysis, and multivariate A/B testing of landing pages and funnels to systematically eliminate friction and maximize conversion rates."
  },
  {
    id: "email-marketing",
    name: "Email Marketing & Automation",
    description: "Strategic newsletter campaigns, behavior-triggered drip sequences, and personalized lifecycle emails designed to nurture leads, recover abandoned carts, and drive repeat purchases."
  },
  {
    id: "marketing-automation",
    name: "Marketing Automation Setup",
    description: "Implementation of complex multi-channel workflows using HubSpot, Marketo, or Pardot to automate lead scoring, segmentation, and nurturing across the entire buyer's journey."
  },

  // ============ DESIGN & CREATIVE ============
  {
    id: "ui-ux-design",
    name: "UI/UX & Product Design",
    description: "Human-centered interface design, rapid prototyping, and usability testing to deliver pixel-perfect, accessible, and intuitively navigable digital experiences."
  },
  {
    id: "graphic-design",
    name: "Creative Graphic Design",
    description: "Professional visual identity creation including logo design, brand guidelines, packaging, infographics, and visual assets that communicate your brand story instantly."
  },

  // ============ BUILD (TECH & DEVELOPMENT) ============
  {
    id: "web-development",
    name: "Custom Web Development",
    description: "Building scalable, secure, and high-performance websites and web applications using modern frameworks (React, Next.js, Vue) with robust backend APIs and CMS integration."
  },
  {
    id: "ecommerce-dev",
    name: "E-Commerce Development",
    description: "Full-service online store setup and optimization on Shopify, WooCommerce, Magento, or custom headless solutions, including payment gateways, inventory sync, and subscription models."
  },
  {
    id: "cms-development",
    name: "CMS & Enterprise Portals",
    description: "Custom development and configuration of enterprise-level CMS platforms (WordPress, Sanity, Contentful) to enable seamless content editing, governance, and multi-site management."
  },
  {
    id: "mobile-development",
    name: "Mobile App Development",
    description: "Native (Swift/Kotlin) and cross-platform (Flutter/React Native) app development focused on performance, offline capabilities, and seamless app store deployment."
  },

  // ============ AUTOMATE & INTEGRATE ============
  {
    id: "crm-integration",
    name: "CRM Strategy & Integration",
    description: "Strategic implementation and custom configuration of Salesforce, HubSpot, or Zoho to unify sales, marketing, and support data into a single, actionable source of truth."
  },
  {
    id: "erp-solutions",
    name: "ERP & Business Systems",
    description: "Integration and optimization of enterprise resource planning systems (Odoo, NetSuite, SAP) to streamline financials, supply chain, and operational workflows."
  },
  {
    id: "data-analytics",
    name: "Advanced Data Analytics & BI",
    description: "Development of custom dashboards (Power BI, Looker, Tableau), data warehousing, and predictive analytics to visualize KPIs and uncover hidden revenue opportunities."
  },
  {
    id: "ai-solutions",
    name: "AI & Machine Learning Integration",
    description: "Deployment of custom AI models and LLM integrations for intelligent chatbots, predictive lead scoring, dynamic pricing, and hyper-personalized content recommendations."
  },

  // ============ INFRASTRUCTURE & SECURITY ============
  {
    id: "cloud-solutions",
    name: "Cloud Architecture & Migration",
    description: "Strategic cloud adoption, infrastructure-as-code (IaC), and lift-and-shift migrations on AWS, Azure, or GCP to ensure high availability, auto-scaling, and cost efficiency."
  },
  {
    id: "devops",
    name: "DevOps & CI/CD Pipelines",
    description: "Implementation of automated build, test, and deployment pipelines (GitHub Actions, Jenkins, GitLab) to accelerate release cycles and improve developer velocity."
  },
  {
    id: "cybersecurity",
    name: "Cybersecurity & Compliance Audits",
    description: "Comprehensive vulnerability assessments, penetration testing, and SOC 2 / GDPR compliance frameworks to fortify your digital assets and ensure enterprise-grade data protection."
  },
  {
    id: "it-support",
    name: "Managed IT Support & Helpdesk",
    description: "Proactive 24/7 IT infrastructure monitoring, helpdesk ticketing, and end-user support to minimize downtime and keep your internal operations running smoothly."
  },
  {
    id: "blockchain-dev",
    name: "Blockchain & Web3 Development",
    description: "Design and development of decentralized applications (dApps), smart contract auditing, and NFT marketplace integration for forward-looking brands entering the Web3 space."
  }
];