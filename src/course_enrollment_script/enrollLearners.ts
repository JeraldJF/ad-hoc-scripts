import fs from 'fs';
import { getUserId } from './services/authService';
import parseCsv from "../services/csv";
import { enrollInCourse, getBatchList, getCourseNodeIds, getProfileCourses, searchLearnerProfile } from './services/courseService';
import { courseConfig } from './config/courseConfig';
import path from 'path';
import { getAuthToken } from '../services/authService';
import _ from 'lodash';
import { config } from './config/config';
import { validateCsvHeaders } from '../services/contentService';
import pLimit from 'p-limit';

const REQUIRED_HEADERS = ['learner_profile_code', 'email'];
const BATCH_SIZE = config.enrollmentBatchSize;
const CONCURRENT_ENROLLMENTS = config.courseBatchSize; 

interface EnrollmentResult {
    userId: string;
    learnerProfile: string;
    courseCode: string;
    status: 'Success' | 'Failure' | 'Skipped';
    reason: string;
}

interface EnrollmentStats {
    successCount: number;
    failureCount: number;
}

function parseLearnerProfileCodes(code: string): string[] {
    return code.replace(/"/g, '').split(',').map(c => c.trim()).filter(c => c);
}

// Process a single enrollment
async function processEnrollment(
    email: string,
    userId: string,
    accessToken: string,
    learnerProfileCode: string,
    nodeId: string,
    courseCode: string,
    userEnrollments: Map<string, Set<string>>
): Promise<EnrollmentResult> {
    try {
        if (userEnrollments.get(email)?.has(nodeId)) {
            console.log(`    User already enrolled in course ${courseCode}`);
            return {
                userId: email,
                learnerProfile: learnerProfileCode,
                courseCode: courseCode,
                status: 'Skipped',
                reason: 'User has already enrolled to this course'
            };
        }

        const batchId = await getBatchList(nodeId);
        if (!batchId) {
            console.log(`    No batch found for course ${courseCode}`);
            return {
                userId: email,
                learnerProfile: learnerProfileCode,
                courseCode: courseCode,
                status: 'Failure',
                reason: 'No batch found for course'
            };
        }

        await enrollInCourse(nodeId, batchId, userId, accessToken);
        console.log(`    Enrolled in course ${courseCode}, batch ${batchId}`);
        userEnrollments.get(email)?.add(nodeId);

        return {
            userId: email,
            learnerProfile: learnerProfileCode,
            courseCode: courseCode,
            status: 'Success',
            reason: 'none'
        };

    } catch (enrollError: any) {
        let errorMessage;
        if (enrollError?.response?.data?.params?.errmsg) {
            errorMessage = enrollError.response.data.params.errmsg;
        } else {
            errorMessage = enrollError?.message || 'Failed to enroll to the course';
        }
        console.error(`    Failed to enroll in course ${courseCode}:`, errorMessage);
        const isAlreadyEnrolled = errorMessage.toLowerCase().includes('user has already enrolled');
        return {
            userId: email,
            learnerProfile: learnerProfileCode,
            courseCode: courseCode,
            status: isAlreadyEnrolled ? 'Skipped' : 'Failure',
            reason: errorMessage || 'Failed to enroll in course'
        };
    }
}

// Process enrollments for a single user
async function processUserEnrollments(
    record: Record<string, string>,
    userEnrollments: Map<string, Set<string>>,
    stats: EnrollmentStats
): Promise<EnrollmentResult[]> {
    const email = record['email'].trim();
    const results: EnrollmentResult[] = [];
    console.time(`Enrollment process for user ${email}`);

    if (!email) {
        const result = {
            userId: email,
            learnerProfile: "none",
            courseCode: 'none',
            status: 'Failure' as const,
            reason: 'Username/Email input is missing'
        };
        stats.failureCount++;
        results.push(result);
        console.log(`User: ${email} => ✅ Successful course enrollments: ${stats.successCount}, ❌ Failure: ${stats.failureCount}`);
        return results;
    }

    const learnerProfileCodes = parseLearnerProfileCodes(record['learner_profile_code']);
    if (_.isEmpty(learnerProfileCodes)) {
        const result = {
            userId: email,
            learnerProfile: "none",
            courseCode: 'none',
            status: 'Failure' as const,
            reason: 'Learner Profile code input is missing'
        };
        stats.failureCount++;
        results.push(result);
        console.log(`User: ${email} => ✅ Successful course enrollments: ${stats.successCount}, ❌ Failure: ${stats.failureCount}`);
        return results;
    }

    try {
        const { userId, accessToken } = await getUserId(email);

        if (!userEnrollments.has(email)) {
            userEnrollments.set(email, new Set());
        }

        // Process learner profiles concurrently
        const profileSettledResults = await Promise.allSettled(
            learnerProfileCodes.map(async (learnerProfileCode) => {
                const profileId = await searchLearnerProfile(learnerProfileCode);
                if (!profileId) {
                    console.log(`User: ${email} => ✅ Successful course enrollments: ${stats.successCount}, ❌ Failure: ${stats.failureCount}`);
                    return [{
                        userId: email,
                        learnerProfile: learnerProfileCode,
                        courseCode: 'none',
                        status: 'Skipped' as const,
                        reason: 'Learner profile does not exist'
                    }];
                }

                const courseNodeIds = await getProfileCourses(profileId);
                if (courseNodeIds.length === 0) {
                    console.log(`User: ${email} => ✅ Successful course enrollments: ${stats.successCount}, ❌ Failure: ${stats.failureCount}`);
                    return [{
                        userId: email,
                        learnerProfile: learnerProfileCode,
                        courseCode: 'none',
                        status: 'Skipped' as const,
                        reason: 'No courses found in learner profile'
                    }];
                }

                const nodeIdToCourseCodeMap = await getCourseNodeIds(courseNodeIds);
                const nodeIds = Object.keys(nodeIdToCourseCodeMap);
                if (nodeIds.length === 0) {
                    console.log(`User: ${email} => ✅ Successful course enrollments: ${stats.successCount}, ❌ Failure: ${stats.failureCount}`);
                    return [{
                        userId: email,
                        learnerProfile: learnerProfileCode,
                        courseCode: 'none',
                        status: 'Skipped' as const,
                        reason: 'No valid courses found for learner profile'
                    }];
                }

                // Process course enrollments concurrently with rate limiting
                const limit = pLimit(CONCURRENT_ENROLLMENTS);
                const enrollmentSettledResults = await Promise.allSettled(
                    nodeIds.map(nodeId =>
                        limit(() => processEnrollment(
                            email,
                            userId,
                            accessToken,
                            learnerProfileCode,
                            nodeId,
                            nodeIdToCourseCodeMap[nodeId],
                            userEnrollments
                        ))
                    )
                );

                // Handle any rejected promises from enrollments
                return enrollmentSettledResults.map(result => {
                    if (result.status === 'fulfilled') {
                        return result.value;
                    } else {
                        return {
                            userId: email,
                            learnerProfile: learnerProfileCode,
                            courseCode: 'none',
                            status: 'Failure' as const,
                            reason: `Enrollment failed: ${result.reason}`
                        };
                    }
                });
            })
        );

        // Handle any rejected promises from profile processing
        const flatResults = profileSettledResults.flatMap(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return [{
                    userId: email,
                    learnerProfile: 'none',
                    courseCode: 'none',
                    status: 'Failure' as const,
                    reason: `Profile processing failed: ${result.reason}`
                }];
            }
        }).flat();

        // Update stats and results
        stats.successCount += flatResults.filter(r => r.status === 'Success').length;
        stats.failureCount += flatResults.filter(r => r.status === 'Failure').length;
        results.push(...flatResults);

    } catch (error: any) {
        let errorMessage;
        if (error?.response?.data?.params?.errmsg) {
            errorMessage = error.response.data.params.errmsg;
        } else {
            errorMessage = error?.message || 'Failed to process enrollments';
        }
        stats.failureCount++;

        for (const learnerProfileCode of learnerProfileCodes) {
            results.push({
                userId: email,
                learnerProfile: learnerProfileCode,
                courseCode: 'none',
                status: 'Failure',
                reason: errorMessage
            });
        }

        console.error(`Error processing enrollments for ${email}:`, errorMessage);
    }

    console.log(`User: ${email} => ✅ Successful course enrollments: ${stats.successCount}, ❌ Failure: ${stats.failureCount}`);
    console.timeEnd(`Enrollment process for user ${email}`);
    await new Promise(resolve => setTimeout(resolve, config.enrollUserWaitInterval));
    return results;
}

async function processEnrollments() {
    await getAuthToken();
    console.time('Total enrollment process');

    const rows = await parseCsv(courseConfig.userLearnerPath);
    const initialHeaderRow = rows[0].map(header => header.trim());
    validateCsvHeaders(initialHeaderRow, REQUIRED_HEADERS);

    const dataRows = rows.slice(1);
    const enrollData = dataRows.map(row =>
        initialHeaderRow.reduce((acc, header, i) => {
            acc[header] = row[i];
            return acc;
        }, {} as Record<string, string>)
    );

    const updatedheaderRow = ['userId', 'learnerProfile', 'courseCode', 'enrollmentStatus', 'reason'];
    const userEnrollments = new Map<string, Set<string>>();
    const stats: EnrollmentStats = { successCount: 0, failureCount: 0 };

    // Process users in batches
    const allResults: EnrollmentResult[] = [];
    for (let i = 0; i < enrollData.length; i += BATCH_SIZE) {
        const batch = enrollData.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(enrollData.length / BATCH_SIZE)}`);

        const batchSettledResults = await Promise.allSettled(
            batch.map(record => processUserEnrollments(record, userEnrollments, stats))
        );

        // Handle any rejected promises from batch processing
        const batchResults = batchSettledResults.flatMap(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return [{
                    userId: 'unknown',
                    learnerProfile: 'none',
                    courseCode: 'none',
                    status: 'Failure' as const,
                    reason: `Batch processing failed: ${result.reason}`
                }];
            }
        });

        allResults.push(...batchResults);
    }

    writeResultsToCSV(updatedheaderRow, allResults);

    console.timeEnd('Total enrollment process');
    console.log('Finished processing all enrollments');
    console.log(`Final Status: ✅ Successful course enrollments: ${stats.successCount}, ❌ Failure: ${stats.failureCount}`);
    console.log(`Enrollment status reports have been saved to ${path.join(__dirname, '..', 'reports', 'enrollment-status.csv')}`);
}

function writeResultsToCSV(headerRow: string[], results: EnrollmentResult[]) {
    const resultsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
    }
    const reportPath = path.join(resultsDir, 'enrollment-status.csv');

    const csvRows = results.map(result => {
        const row = [
            result.userId,
            result.learnerProfile,
            result.courseCode,
            result.status,
            result.reason
        ];
        return row.map(field => {
            if (field.includes(',') || field.includes('"')) {
                return `"${field.replace(/"/g, '""')}"`;
            }
            return field;
        }).join(',');
    });

    const csvContent = [headerRow.join(','), ...csvRows].join('\n');
    fs.writeFileSync(reportPath, csvContent);
}

processEnrollments().catch(console.error);