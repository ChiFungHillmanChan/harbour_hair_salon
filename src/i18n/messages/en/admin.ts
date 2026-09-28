import type { MessageTree } from '../../format';

/** Admin shell and admin-wide shared widgets. Area-specific admin text lives in adminSchedule / adminCatalog / adminContent / adminOps / adminStaff. */
const admin = {
  monthSelector: {
    previous: 'Previous month: {period}',
    next: 'Next month: {period}',
    month: 'Month',
    year: 'Year',
    go: 'Go',
  },
  sidebar: {
    title: 'ADMIN PANEL',
    navLabel: 'Admin navigation',
    openMenu: 'Open admin menu',
    closeMenu: 'Close admin menu',
    loggedInAs: 'Logged in as',
    signOut: 'Sign Out',
    signingOut: 'Signing Out…',
  },
  nav: {
    schedule: 'Schedule',
    openingHours: 'Opening Hours',
    services: 'Services & Pricing',
    categories: 'Category Pages',
    stylists: 'Stylists',
    faqs: 'FAQs',
    discounts: 'Discounts',
    offers: 'Offers',
    reviews: 'Reviews',
    journal: 'Journal',
    users: 'Admin Users',
    settings: 'Site Settings',
    integrations: 'Integrations',
    operations: 'Operations',
    employees: 'Employees',
    timesheets: 'Timesheets',
    shifts: 'Shifts',
    payroll: 'Payroll',
    kiosk: 'Kiosk',
  },
} satisfies MessageTree;

export default admin;
