import { onRequest as __api_backup_kv_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\backup-kv.js"
import { onRequest as __api_formulas_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\formulas.js"
import { onRequest as __api_init_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\init.js"
import { onRequest as __api_medicines_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\medicines.js"
import { onRequest as __api_platform_prescriptions_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\platform-prescriptions.js"
import { onRequest as __api_prescriptions_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\prescriptions.js"
import { onRequest as __api_restore_kv_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\restore-kv.js"
import { onRequest as __api_users_js_onRequest } from "C:\\Users\\61767\\Documents\\trae_projects\\kyt-zy\\tcm-prescription-system\\functions\\api\\users.js"

export const routes = [
    {
      routePath: "/api/backup-kv",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_backup_kv_js_onRequest],
    },
  {
      routePath: "/api/formulas",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_formulas_js_onRequest],
    },
  {
      routePath: "/api/init",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_init_js_onRequest],
    },
  {
      routePath: "/api/medicines",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_medicines_js_onRequest],
    },
  {
      routePath: "/api/platform-prescriptions",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_platform_prescriptions_js_onRequest],
    },
  {
      routePath: "/api/prescriptions",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_prescriptions_js_onRequest],
    },
  {
      routePath: "/api/restore-kv",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_restore_kv_js_onRequest],
    },
  {
      routePath: "/api/users",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_users_js_onRequest],
    },
  ]