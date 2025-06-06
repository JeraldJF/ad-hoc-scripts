import axios from "axios";
import { routes } from "../quiz_creation_script/config/routes";
import { config } from "../quiz_creation_script/config/config";
import globalConfig from "../globalConfigs";
import _ from "lodash";

export class ContentExistsError extends Error {
    constructor(code: string, public hasQuestion: boolean = false) {
        super(`Content with code ${code} already exists`);
        this.name = 'ContentExistsError';
    }
}

export async function searchContent(code: string, questionExists?: boolean, quizExists?: boolean): Promise<any> {
    try {
        const response = await axios({
            method: 'post',
            url: `${config.baseUrl}${routes.searchContent}`,
            headers: {
                'Content-Type': 'application/json',
                'X-Channel-Id': globalConfig.channelId,
                'Authorization': config.apiAuthKey,
                'x-authenticated-user-token': globalConfig.creatorUserToken
            },
            data: {
                request: {
                    filters: {
                        status: [
                            "Draft",
                            "FlagDraft",
                            "Review",
                            "Processing",
                            "Live",
                            "Unlisted",
                            "FlagReview"
                        ],
                        code: code,
                        createdBy: globalConfig.createdBy
                    },
                    offset: 0,
                    limit: 1,
                    query: "",
                    sort_by: {
                        lastUpdatedOn: "desc"
                    }
                }
            }
        });

        if (response.data.result.count && response.data.result.count > 0) {
            if (questionExists) {
                const content = response.data.result.items[0];
                if (content.type === "mcq" && content.itemType === "UNIT") {
                    return { exists: true, question: true, identifier: content.identifier, score: content.max_score };
                }
            }
            else if (quizExists) {
                return { exists: true, quiz: true };
            }
            throw new ContentExistsError(code);
        }
        return { exists: false };
    } catch (error) {
        if (error instanceof ContentExistsError) {
            throw error;
        }
        return { exists: true };
    }
}

export const validateCsvHeaders = (headers: string[], REQUIRED_HEADERS: string[]) => {
    const missingHeaders = REQUIRED_HEADERS.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
        console.log(`Missing required headers: ${missingHeaders.join(', ')}`);
        throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
    }
}