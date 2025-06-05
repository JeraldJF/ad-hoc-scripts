import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getAuthToken } from '../services/authService';
import globalConfig from '../globalConfigs';
import { routes } from './config/routes';
import { getAssessmentItem, getContent, publishContent, reviewContent, updateContent } from './service/quizService';
import { quizConfig, assessmentDefaultValues } from './config/config';
import parseCsv from '../services/csv';
import { validateCsvHeaders } from '../services/contentService';
const REQUIRED_HEADERS = ['quiz_code', 'question_code', 'language'];

interface QuizUpdateRow {
    quiz_code: string;
    question_code: string;
    language: string;
    status?: string;
    error_message?: string;
    [key: string]: string | undefined; // Add index signature
}

interface QuizMapping {
    [quiz_code: string]: { question_code: string; language: string }[];
}

interface ParsedCsvResult {
    mapping: QuizMapping;
    originalRows: QuizUpdateRow[];
    headers: string[];
}

// Method to read and parse quiz-update.csv
const readQuizUpdateCSV = async (): Promise<ParsedCsvResult> => {
    try {
        const rows = await parseCsv(quizConfig.csvPath);
        const headers = rows[0].map(header => header.trim());
        const dataRows = rows.slice(1);

        validateCsvHeaders(headers, REQUIRED_HEADERS);
        dataRows.forEach((row, index) => {
            if (row.some(col => col.trim() === '')) {
                throw new Error(`Empty value found at row ${index + 2}. All columns must be non-empty.`);
            }
        });

        // Convert each row into an object using the headers
        const parsedRows = dataRows.map(row =>
            headers.reduce((acc, header, i) => {
                acc[header] = row[i];
                return acc;
            }, {} as QuizUpdateRow)
        );

        const mapping: QuizMapping = {};

        parsedRows.forEach(({ quiz_code, question_code, language }) => {
            const trimmedQuizCode = quiz_code.trim();
            const trimmedQuestionCode = question_code.trim();
            const trimmedLanguage = language.trim();
            if (!mapping[trimmedQuizCode]) {
                mapping[trimmedQuizCode] = [];
            }
            mapping[trimmedQuizCode].push({ question_code: trimmedQuestionCode, language: trimmedLanguage });
        });

        return { mapping, originalRows: parsedRows, headers };
    } catch (error: any) {
        throw new Error(`Error reading quiz-update.csv: ${error?.message}`);
    }

};

// Method to process quiz updates
const processQuizUpdates = async () => {
    // Create results directory if it doesn't exist
    const resultsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir);
    }

    const { mapping: quizMapping, originalRows, headers } = await readQuizUpdateCSV();
    const statusReport: QuizUpdateRow[] = [...originalRows].map(row => ({
        ...row,
        status: 'Pending',
        error_message: 'none'
    }));

    const updatedMapping: Record<string, { question_code: string; identifier: string }[]> = {};

    for (const quiz_code in quizMapping) {
        try {
            const filters = quizMapping[quiz_code].map((item) => item.question_code)
            const response = await axios.post(`${globalConfig.baseUrl}${routes.searchContent}?fields=identifier,code`,
                {
                    request: {
                        filters: {
                            code: filters,
                        },
                    },
                },
                {
                    headers: {
                        'X-Channel-Id': globalConfig.channelId,
                        'Content-Type': 'application/json',
                        'Authorization': globalConfig.apiAuthKey,
                        'x-authenticated-user-token': globalConfig.creatorUserToken
                    }
                }
            );

            if (response.data.result.count > 0) {
                // Check if all question codes were found
                const returnedQuestionCodes = response.data.result.items.map((item: any) => item.code);
                const missingQuestionCodes = filters.filter(code => !returnedQuestionCodes.includes(code));

                // Update status for missing questions
                if (missingQuestionCodes.length > 0) {
                    statusReport.forEach(row => {
                        if (row.quiz_code === quiz_code && missingQuestionCodes.includes(row.question_code)) {
                            row.status = 'Skipped';
                            row.error_message = 'Question not found';
                        }
                    });
                }

                const returnedItems = response.data.result.items;

                const codeToIdentifierMap = new Map<string, string>();
                returnedItems.forEach((item: any) => {
                    codeToIdentifierMap.set(item.code, item.identifier);
                });

                const items = filters.map(code => ({
                    question_code: code,
                    identifier: codeToIdentifierMap.get(code) || ''  // fallback if somehow missing
                }));

                updatedMapping[quiz_code] = items;
            } else {
                statusReport.forEach(row => {
                    if (row.quiz_code === quiz_code) {
                        row.status = 'Failed';
                        row.error_message = 'No questions found';
                    }
                });
            }
        } catch (error: any) {
            console.log(`Failed to fetch questions for quiz code: ${quiz_code} : `, error.message);
            statusReport.forEach(row => {
                if (row.quiz_code === quiz_code) {
                    row.status = 'Failed';
                    row.error_message = error.message;
                }
            });
        }
    }

    for (const quiz_code in updatedMapping) {
        // Initialize arrays for each quiz separately to not mix failed questions from different quizzes
        const assessmentItems = [];
        const formattedAssessmentItems = [];
        const questionIdentifiers = [];

        for (const { identifier, question_code } of updatedMapping[quiz_code]) {
            try {
                questionIdentifiers.push({ identifier: identifier });
                const readResponse = await axios.get(`${globalConfig.baseUrl}${routes.questionsRead}/${identifier}`, {
                    headers: {
                        'Authorization': globalConfig.apiAuthKey,
                        'x-authenticated-user-token': globalConfig.creatorUserToken,
                        'X-Channel-Id': globalConfig.channelId
                    }
                });

                const assessmentItem = readResponse.data.result.assessment_item;
                const language = quizMapping[quiz_code].find(item => item.question_code === question_code)?.language || '';

                if (!globalConfig.ALLOWED_LANGUAGES.includes(language)) {
                    throw new Error(`Invalid language '${language}'.`);
                }

                if (language) {
                    assessmentItem.language = [language];
                    if (assessmentItem.body) {
                        const bodyData = JSON.parse(assessmentItem.body);
                        if (bodyData.data.config.metadata) {
                            const languageArray = [`${language}`]
                            bodyData.data.config.metadata.language = languageArray;
                        }
                        assessmentItem.body = JSON.stringify(bodyData);
                    }

                    // Prepare metadata for update request
                    const metadata = {
                        code: assessmentItem.code,
                        isShuffleOption: assessmentItem.isShuffleOption,
                        body: assessmentItem.body,
                        language: assessmentItem.language,
                        max_score: assessmentItem.max_score,
                        templateType: assessmentItem.templateType,
                        qlevel: assessmentItem.qlevel,
                        category: assessmentItem.category,
                        name: assessmentItem.name,
                        title: assessmentItem.title,
                        copyright: assessmentItem.copyright,
                        organisation: assessmentItem.organisation,
                        type: assessmentItem.type,
                        framework: assessmentItem.framework,
                        itemType: assessmentItem.itemType,
                        version: assessmentItem.version,
                        createdBy: globalConfig.createdBy,
                        channel: assessmentItem.channel,
                        templateId: assessmentItem.templateId,
                        template: assessmentItem.template,
                        questionTitle: assessmentItem.questionTitle,
                        isPartialScore: assessmentItem.isPartialScore,
                        evalUnordered: assessmentItem.evalUnordered,
                        options: assessmentItem.options
                    };

                    const updateBody = {
                        request: {
                            assessment_item: {
                                objectType: 'AssessmentItem',
                                metadata,
                                outRelations: []
                            }
                        }
                    };

                    await axios.patch(`${globalConfig.baseUrl}${routes.questionUpdate}/${identifier}`, updateBody, {
                        headers: {
                            'Authorization': globalConfig.apiAuthKey,
                            'x-authenticated-user-token': globalConfig.creatorUserToken,
                            'X-Channel-Id': globalConfig.channelId,
                            'Content-Type': 'application/json'
                        }
                    });

                    const assessmentData = await getAssessmentItem(identifier);
                    if (assessmentData?.result?.assessment_item) {
                        const item = assessmentData.result.assessment_item;
                        assessmentItems.push(item);
                        const body = JSON.parse(item.body);
                        const formattedItem = {
                            "id": identifier,
                            "type": "mcq",
                            "pluginId": "org.ekstep.questionunit.mcq",
                            "pluginVer": "1.3",
                            "templateId": "horizontalMCQ",
                            "data": {
                                "__cdata": JSON.stringify(body.data.data)
                            },
                            "config": {
                                "__cdata": JSON.stringify(body.data.config)
                            },
                            "w": 80,
                            "h": 85,
                            "x": 9,
                            "y": 6
                        };

                        formattedAssessmentItems.push(formattedItem);

                        // Update status for successful question update
                        console.log(`Question ${question_code} with id ${identifier} updated successfully.`);
                        statusReport.forEach(row => {
                            if (row.quiz_code === quiz_code && row.question_code === question_code) {
                                row.status = 'Question Update Success';
                                row.error_message = 'none';
                            }
                        });
                    }
                }
            } catch (error: any) {
                console.log(`Failed to update question ${question_code} for quiz ${quiz_code}: ${error.message}`);
                statusReport.forEach(row => {
                    if (row.quiz_code === quiz_code && row.question_code === question_code) {
                        row.status = 'Question Update Failed';
                        row.error_message = error.message;
                    }
                });
            }
        }

        try {
            const headers = {
                'X-Channel-Id': globalConfig.channelId,
                'Content-Type': 'application/json',
                'Authorization': globalConfig.apiAuthKey,
                'x-authenticated-user-token': globalConfig.creatorUserToken
            };
            const requestBody = {
                request: {
                    filters: {
                        code: quiz_code,
                    }
                }
            };
            const response = await axios.post(`${globalConfig.baseUrl}${routes.searchContent}`, requestBody, { headers });
            if (response.data.result.count > 0) {
                const identifier = response.data.result.content[0].identifier
                const { versionKey, totalQuestions, totalScore, editorState, plugins, name } = await getContent(identifier);
                const updateData = {
                    versionKey,
                    totalQuestions,
                    totalScore,
                    questions: questionIdentifiers,
                    editorState,
                    plugins,
                    body: JSON.stringify({
                        "theme": {
                            "id": "theme",
                            "version": "1.0",
                            "startStage": "d9ae4d48-389a-4757-867c-dc6a4beae92e",
                            "stage": [
                                {
                                    "x": 0,
                                    "y": 0,
                                    "w": 100,
                                    "h": 100,
                                    "id": "d9ae4d48-389a-4757-867c-dc6a4beae92e",
                                    "rotate": null,
                                    "config": {
                                        "__cdata": "{\"opacity\":100,\"strokeWidth\":1,\"stroke\":\"rgba(255, 255, 255, 0)\",\"autoplay\":false,\"visible\":true,\"color\":\"#FFFFFF\",\"genieControls\":false,\"instructions\":\"\"}"
                                    },
                                    "param": [
                                        {
                                            "name": "next",
                                            "value": "summary_stage_id"
                                        }
                                    ],
                                    "manifest": {
                                        "media": []
                                    },
                                    "org.ekstep.questionset": [
                                        {
                                            "x": 9,
                                            "y": 6,
                                            "w": 80,
                                            "h": 85,
                                            "rotate": 0,
                                            "z-index": 0,
                                            "id": "6d187a84-6ee0-4513-96ce-1d856e187c9b",
                                            "data": {
                                                "__cdata": JSON.stringify(assessmentItems)
                                            },
                                            "config": {
                                                "__cdata": JSON.stringify({ "title": name, "max_score": totalScore, "allow_skip": true, "show_feedback": false, "shuffle_questions": false, "shuffle_options": false, "total_items": questionIdentifiers.length, "btn_edit": "Edit" })
                                            },
                                            "org.ekstep.question": formattedAssessmentItems
                                        }]
                                },
                                { "x": 0, "y": 0, "w": 100, "h": 100, "rotate": null, "config": { "__cdata": "{\"opacity\":100,\"strokeWidth\":1,\"stroke\":\"rgba(255, 255, 255, 0)\",\"autoplay\":false,\"visible\":true,\"color\":\"#FFFFFF\",\"genieControls\":false,\"instructions\":\"\"}" }, "id": "summary_stage_id", "manifest": { "media": [{ "assetId": "summaryImage" }] }, "org.ekstep.summary": [{ "config": { "__cdata": "{\"opacity\":100,\"strokeWidth\":1,\"stroke\":\"rgba(255, 255, 255, 0)\",\"autoplay\":false,\"visible\":true}" }, "id": "summary_plugin_id", "rotate": 0, "x": 6.69, "y": -27.9, "w": 77.45, "h": 125.53, "z-index": 0 }] }
                            ],
                            "manifest": assessmentDefaultValues.manifest,
                            "plugin-manifest": assessmentDefaultValues.pluginManifest,
                            "compatibilityVersion": 2
                        }
                    })
                }
                await updateContent(identifier, versionKey, updateData);
                statusReport.forEach(row => {
                    if (row.quiz_code === quiz_code && row.error_message === 'none') {
                        row.status = 'Quiz Updated';
                        row.error_message = 'none';
                    }
                });

                await reviewContent(identifier);
                await publishContent(identifier);

                // Update final status after publishing
                console.log(`Quiz ${quiz_code} updated and published successfully.`);
                statusReport.forEach(row => {
                    if (row.quiz_code === quiz_code && row.status === 'Quiz Updated') {
                        row.status = 'Published';
                        row.error_message = 'none';
                    }
                });

                await new Promise(resolve => setTimeout(resolve, globalConfig.waitInterval));
            }
        } catch (error: any) {
            console.log("Failed to update quiz content for quiz code: ", quiz_code, error.message);
            statusReport.forEach(row => {
                if (row.quiz_code === quiz_code) {
                    row.status = 'Quiz Update Failed';
                    row.error_message = error.message;
                }
            });
        }
    }

    // Save status report to CSV
    const allHeaders = [...headers, 'status', 'error_message'];
    const csvContent = [
        allHeaders.join(','),
        ...statusReport.map(row =>
            allHeaders.map(header => {
                const value = row[header] || '';
                return value.includes(',') ? `"${value}"` : value;
            }).join(',')
        )
    ].join('\n');

    const reportPath = path.join(resultsDir, 'quiz-update-status.csv');
    fs.writeFileSync(reportPath, csvContent);
    console.log(`Quiz update status report saved to ${reportPath}`);
};

async function main() {
    try {
        await getAuthToken();
        await processQuizUpdates();
    } catch (error) {
        console.error('Processing failed:', error);
        process.exit(1);
    }
}

main();