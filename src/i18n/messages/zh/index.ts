import type { Localized, Messages } from '../types';
import common from './common';
import errors from './errors';
import pricing from './pricing';
import emails from './emails';
import home from './home';
import services from './services';
import stylists from './stylists';
import offers from './offers';
import contact from './contact';
import local from './local';
import reviews from './reviews';
import blog from './blog';
import tryColor from './tryColor';
import salon3d from './salon3d';
import legal from './legal';
import auth from './auth';
import booking from './booking';
import appointments from './appointments';
import admin from './admin';
import adminSchedule from './adminSchedule';
import adminCatalog from './adminCatalog';
import adminContent from './adminContent';
import adminOps from './adminOps';
import adminStaff from './adminStaff';
import kiosk from './kiosk';

/** Typed against the English tree: a missing or extra key fails the type check. */
export const zh: Localized<Messages> = {
  common,
  errors,
  pricing,
  emails,
  home,
  services,
  stylists,
  offers,
  contact,
  local,
  reviews,
  blog,
  tryColor,
  salon3d,
  legal,
  auth,
  booking,
  appointments,
  admin,
  adminSchedule,
  adminCatalog,
  adminContent,
  adminOps,
  adminStaff,
  kiosk,
};
