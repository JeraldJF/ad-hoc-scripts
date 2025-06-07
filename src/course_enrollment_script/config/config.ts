import globalConfig from "../../globalConfigs"

export const config = {
    baseUrl: globalConfig.baseUrl || 'https://dev-fmps.sunbirded.org',
    apiAuthKey: globalConfig.apiAuthKey || '',
    clientId: globalConfig.clientId || '',
    clientSecret: globalConfig.clientSecret || '',
    grant_type: globalConfig.grant_type || 'password',
    channelId: globalConfig.channelId || '01429195271738982411',
    enrollUserWaitInterval: process.env.ENROLL_USER_WAIT_INTERVAL ? Number(process.env.ENROLL_USER_WAIT_INTERVAL) : 0,
    enrollmentBatchSize: process.env.ENROLLMENT_BATCH_SIZE ? Number(process.env.ENROLLMENT_BATCH_SIZE) : 5,
    courseBatchSize: process.env.COURSE_BATCH_SIZE ? Number(process.env.COURSE_BATCH_SIZE) : 1,
}