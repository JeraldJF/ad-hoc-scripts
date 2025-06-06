import axios from 'axios';
import { assessmentConfig } from '../config/quizConfigs';
import { routes } from '../config/routes';
import { questionConfig } from '../config/questionConfigs';
import { config } from '../config/config';
import globalConfig from '../../globalConfigs';

interface ContentRequestBody {
    request: {
        content: {
            code: string;
            name: string;
            maxAttempts: number;
            description: string;
            createdBy: string;
            organisation: string[];
            createdFor: string[];
            framework: string;
            mimeType: string;
            creator: string;
            contentType: string;
            primaryCategory?: string;
            language: string[];
        }
    }
}

interface ContentUpdateRequestBody {
    request: {
        content: {
            versionKey: string;
            lastUpdatedBy: string;
            stageIcons: string;
            totalQuestions: number;
            totalScore: number;
            questions: Array<{ identifier: string }>;
            assets: any[];
            editorState: string;
            pragma: any[];
            plugins: Array<{
                identifier: string;
                semanticVersion: string;
            }>;
            body: string;
            copyright: string;
            organisation: string[];
        }
    }
}

export async function createAssessment(
    code: string,
    name: string,
    maxAttempts: number,
    contentType: string,
    language: string
): Promise<{ identifier: string; versionKey: string }> {
    
    const contentBody: ContentRequestBody['request']['content'] = {
        code,
        name,
        maxAttempts,
        description: "Enter description for Assessment",
        language: [language],
        createdBy: globalConfig.createdBy,
        organisation: assessmentConfig.organisation,
        createdFor: [globalConfig.channelId],
        framework: assessmentConfig.framework,
        mimeType: assessmentConfig.mimeType,
        creator: assessmentConfig.creator,
        contentType: contentType === 'assess' ? 'SelfAssess' : 'Resource'
    };

    if (contentType !== 'assess') {
        contentBody.primaryCategory = 'Practise Assess';
    }

    const body: ContentRequestBody = {
        request: {
            content: contentBody
        }
    };

    const headers = {
        'X-Channel-Id': globalConfig.channelId,
        'Content-Type': 'application/json',
        'Authorization': config.apiAuthKey,
        'x-authenticated-user-token': globalConfig.creatorUserToken
    };

    try {
        const response = await axios.post(`${config.baseUrl}${routes.createContent}`, body, { headers });
        console.log('Create assessment API Response:', response.data);
        return {
            identifier: response.data.result.identifier,
            versionKey: response.data.result.versionKey
        };
    } catch (error) {
        console.error('Create assessment API Error:');
        throw error;
    }
}

export async function updateContent(
    nodeId: string,
    versionKey: string,
    updateData: Partial<ContentUpdateRequestBody['request']['content']>
): Promise<void> {
    const body = {
        request: {
            content: {
                versionKey,
                lastUpdatedBy: globalConfig.createdBy,
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
                consumerId: globalConfig.createdBy || ''
            }
        }
    };

    const headers = {
        'X-Channel-Id': globalConfig.channelId,
        'Content-Type': 'application/json',
        'Authorization': config.apiAuthKey,
        'x-authenticated-user-token': globalConfig.creatorUserToken
    };

    try {
        const response = await axios.patch(`${config.baseUrl}${routes.updateContent}/${nodeId}`, body, { headers });
        console.log('Quiz Update API Response:', response.data);
    } catch (error) {
        console.error('Quiz Update API Error:');
        throw error;
    }
}

export async function getAssessmentItem(identifier: string): Promise<any> {
    const headers = {
        'Authorization': config.apiAuthKey,
    };

    try {
        const response = await axios.get(`${config.baseUrl}${routes.questionsRead}/${identifier}`, { headers });
        console.log(`Fetched assessment item ${identifier}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching assessment item ${identifier}:`);
        throw error;
    }
}

export async function reviewContent(identifier: string): Promise<void> {
    const headers = {
        'X-Channel-Id': globalConfig.channelId,
        'Content-Type': 'application/json',
        'Authorization': config.apiAuthKey,
        'x-authenticated-user-token': globalConfig.creatorUserToken
    };

    const body = {
        request: {
            content: {}
        }
    };

    try {
        const response = await axios.post(`${config.baseUrl}${routes.reviewContent}/${identifier}`, body, { headers });
        console.log('Quiz Review API Response:', response.data);
    } catch (error) {
        console.error('Quiz Review API Error:');
        throw error;
    }
}

export async function publishContent(identifier: string): Promise<void> {
    const headers = {
        'X-Channel-Id': globalConfig.channelId,
        'Content-Type': 'application/json',
        'Authorization': config.apiAuthKey,
        'x-authenticated-user-token': globalConfig.reviewerUserToken
    };

    const body = {
        request: {
            content: {
                lastPublishedBy: globalConfig.publishedBy
            }
        }
    };

    try {
        const response = await axios.post(`${config.baseUrl}${routes.publishContent}/${identifier}`, body, { headers });
        console.log('Quiz Publish API Response:', response.data);
    } catch (error) {
        console.error('Quiz Publish API Error:' );
        throw error;
    }
}