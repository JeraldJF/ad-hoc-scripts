import globalConfig from "../../globalConfigs"

export const config = {
    baseUrl: globalConfig.baseUrl || 'https://dev-fmps.sunbirded.org',
    apiAuthKey: globalConfig.apiAuthKey || '',
    clientId: globalConfig.clientId || '',
    clientSecret: globalConfig.clientSecret || '',
    grant_type: globalConfig.grant_type || 'password',
    channelId: globalConfig.channelId || '01429195271738982411',
    enrollUserWaitInterval: Number(process.env.ENROLL_USER_WAIT_INTERVAL) || 0
}