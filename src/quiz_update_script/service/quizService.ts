import axios from "axios";
import globalConfig from "../../globalConfigs";
import { routes } from "../config/routes";
import { assessmentConfig, questionConfig } from "../config/config";

export async function getAssessmentItem(identifier: string): Promise<any> {
    const headers = {
        'Authorization': globalConfig.apiAuthKey,
    };

    try {
        const response = await axios.get(`${globalConfig.baseUrl}${routes.questionsRead}/${identifier}`, { headers });
        console.log(`Fetched assessment item ${identifier}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching assessment item ${identifier}:`);
        throw error;
    }
}

export async function getContent(id: string) {
    const headers = {
        'X-Channel-Id': globalConfig.channelId,
        'Authorization': globalConfig.apiAuthKey,
        'x-authenticated-user-token': globalConfig.creatorUserToken
    };

    try {
        const response = await axios.get(`${globalConfig.baseUrl}${routes.readContent}/${id}?fields=versionKey,totalQuestions,totalScore,editorState,plugins,name`, { headers });
        const { versionKey, totalQuestions, totalScore, editorState, plugins, name } = response.data.result.content;
        return {
            id,
            versionKey,
            totalQuestions,
            totalScore,
            editorState,
            plugins,
            name
        }
    } catch (error) {
        console.error(`Error getting content ${id}:`);
        throw error;
    }
}

export async function updateContent(
    nodeId: string,
    versionKey: string,
    updateData: any
): Promise<void> {
    const body = {
        request: {
            content: {
                versionKey,
                lastUpdatedBy: assessmentConfig.createdBy,
                stageIcons: updateData.stageIcons || "",
                totalQuestions: updateData.totalQuestions || 0,
                totalScore: updateData.totalScore || 0,
                questions: updateData.questions || [],
                assets: updateData.assets || [],
                editorState: updateData.editorState || "",
                pragma: updateData.pragma || [],
                plugins: updateData.plugins || [],
                body: updateData.body || "",
                copyright: questionConfig.metadata.copyright,
                organisation: assessmentConfig.organisation || [],
                consumerId: assessmentConfig.createdBy || ''
            }
        }
    };

    const headers = {
        'X-Channel-Id': assessmentConfig.channelId,
        'Content-Type': 'application/json',
        'Authorization': globalConfig.apiAuthKey,
        'x-authenticated-user-token': globalConfig.creatorUserToken
    };

    try {
        const response = await axios.patch(`${globalConfig.baseUrl}${routes.updateContent}/${nodeId}`, body, { headers });
        console.log('Quiz Update API Response:', response.data);
    } catch (error) {
        console.error('Quiz Update API Error:');
        throw error;
    }
}

export async function reviewContent(identifier: string): Promise<void> {
    const headers = {
        'X-Channel-Id': assessmentConfig.channelId,
        'Content-Type': 'application/json',
        'Authorization': globalConfig.apiAuthKey,
        'x-authenticated-user-token': globalConfig.creatorUserToken
    };

    const body = {
        request: {
            content: {}
        }
    };

    try {
        const response = await axios.post(`${globalConfig.baseUrl}${routes.reviewContent}/${identifier}`, body, { headers });
        console.log('Quiz Review API Response:', response.data);
    } catch (error) {
        console.error('Quiz Review API Error:');
        throw error;
    }
}

export async function publishContent(identifier: string): Promise<void> {
    const headers = {
        'X-Channel-Id': assessmentConfig.channelId,
        'Content-Type': 'application/json',
        'Authorization': globalConfig.apiAuthKey,
        'x-authenticated-user-token': globalConfig.reviewerUserToken
    };

    const body = {
        request: {
            content: {
                lastPublishedBy: assessmentConfig.createdBy
            }
        }
    };

    try {
        const response = await axios.post(`${globalConfig.baseUrl}${routes.publishContent}/${identifier}`, body, { headers });
        console.log('Quiz Publish API Response:', response.data);
    } catch (error) {
        console.error('Quiz Publish API Error:' );
        throw error;
    }
}