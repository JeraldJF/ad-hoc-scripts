import axios from "axios";
import globalConfig from "../globalConfigs";
import { routes } from "../course_enrollment_script/config/routes";
import jwt from "jsonwebtoken";

export async function getAuthToken(): Promise<{ creatorToken: string, reviewerToken: string }> {
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': globalConfig.apiAuthKey
    };

    // Get creator token
    const creatorTokenData = new URLSearchParams({
        'client_id': globalConfig.clientId,
        'client_secret': globalConfig.clientSecret,
        'grant_type': globalConfig.grant_type,
        'username': globalConfig.creatorUsername,
        'password': globalConfig.creatorPassword,
    });

    // Get reviewer token
    const reviewerTokenData = new URLSearchParams({
        'client_id': globalConfig.clientId,
        'client_secret': globalConfig.clientSecret,
        'grant_type': globalConfig.grant_type,
        'username': globalConfig.reviewerUsername,
        'password': globalConfig.reviewerPassword,
    });

    try {
        // Get creator initial token
        const creatorTokenResponse = await axios.post(
            `${globalConfig.baseUrl}${routes.getRefeshToken}`,
            creatorTokenData,
            { headers }
        );

        const creatorRefreshToken = creatorTokenResponse.data.refresh_token;

        // Use creator refresh token to get access token
        const creatorRefreshData = new URLSearchParams({
            'refresh_token': creatorRefreshToken
        });

        const creatorRefreshResponse = await axios.post(
            `${globalConfig.baseUrl}${routes.getToken}`,
            creatorRefreshData,
            { headers }
        );

        const creatorAccessToken = creatorRefreshResponse.data.result.access_token;

        // Get reviewer initial token
        const reviewerTokenResponse = await axios.post(
            `${globalConfig.baseUrl}${routes.getRefeshToken}`,
            reviewerTokenData,
            { headers }
        );

        const reviewerRefreshToken = reviewerTokenResponse.data.refresh_token;

        // Use reviewer refresh token to get access token
        const reviewerRefreshData = new URLSearchParams({
            'refresh_token': reviewerRefreshToken
        });

        const reviewerRefreshResponse = await axios.post(
            `${globalConfig.baseUrl}${routes.getToken}`,
            reviewerRefreshData,
            { headers }
        );

        const reviewerAccessToken = reviewerRefreshResponse.data.result.access_token;

        // Update the config file with the new tokens
        globalConfig.creatorUserToken = creatorAccessToken;
        globalConfig.reviewerUserToken = reviewerAccessToken;

        const reviewerDecoded = jwt.decode(reviewerAccessToken);
        const creatorDecoded = jwt.decode(creatorAccessToken);
        
        if (creatorDecoded && typeof creatorDecoded === 'object') {
            const decodedSub = creatorDecoded.sub;

            let organisationId: string = globalConfig.channelId;

            const contentCreatorRole = creatorDecoded.roles.find(
                (role: any) => role.role === globalConfig.contentCreatorRoleName
            );

            if (contentCreatorRole && contentCreatorRole.scope?.length > 0) {
                organisationId = contentCreatorRole.scope[0].organisationId;
            }
            const createdById = decodedSub ? decodedSub.split(':').pop() as string : globalConfig.createdBy
            globalConfig.createdBy = createdById
            globalConfig.channelId = organisationId;
        }

        if (reviewerDecoded && typeof reviewerDecoded === 'object') {
            const decodedSub = reviewerDecoded.sub;
            const publishedById = decodedSub ? decodedSub.split(':').pop() as string : globalConfig.publishedBy
            globalConfig.publishedBy = publishedById
        }
        return {
            creatorToken: creatorAccessToken,
            reviewerToken: reviewerAccessToken
        };
    } catch (error) {
        throw error;
    }
}