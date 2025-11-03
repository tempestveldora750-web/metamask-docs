import { useEffect, useState } from 'react'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'

const DISCOURSE_URL = 'https://builder.metamask.io'

export default function DiscourseComment(props) {
  // eslint-disable-next-line react/prop-types
  const { postUrl, discourseTopicId, metadata = {} } = props
  const { siteConfig } = useDocusaurusContext()
  const { customFields } = siteConfig

  const DISCOURSE_API_KEY = customFields.DISCOURSE_API_KEY
  const DISCOURSE_API_USERNAME = customFields.DISCOURSE_API_USERNAME || 'system'
  const DISCOURSE_CATEGORY_ID = customFields.DISCOURSE_CATEGORY_ID || '6'

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [topicId, setTopicId] = useState(discourseTopicId)

  // Extract content from page for topic creation
  const extractContentExcerpt = () => {
    try {
      // Find main content area
      const contentSelector = 'article .markdown, main .markdown, .theme-doc-markdown'
      const contentElement = document.querySelector(contentSelector)

      if (!contentElement) {
        return metadata.description || ''
      }

      // Get text from first few paragraphs, skip imports and components
      const paragraphs = contentElement.querySelectorAll('p')
      let excerpt = ''
      let wordCount = 0

      for (const p of paragraphs) {
        const text = p.textContent.trim()

        // Skip imports, empty paragraphs, and components
        if (!text || text.startsWith('import ') || text.includes('</') || text.includes('>{')) {
          continue
        }

        const words = text.split(' ')
        if (wordCount + words.length <= 200) {
          excerpt += (excerpt ? '\n\n' : '') + text
          wordCount += words.length
        } else {
          const remainingWords = 200 - wordCount
          if (remainingWords > 10) {
            excerpt += (excerpt ? '\n\n' : '') + words.slice(0, remainingWords).join(' ') + '...'
          }
          break
        }
      }

      return excerpt || metadata.description || ''
    } catch (e) {
      console.warn('Failed to extract content:', e)
      return metadata.description || ''
    }
  }

  // Format post content for Discourse
  const formatDiscourseContent = excerpt => {
    const { title, image, description, tags = [], author, date } = metadata
    const imageUrl = image?.startsWith('http') ? image : `https://docs.metamask.io/${image || ''}`

    let content = ''

    // Add banner image if available
    if (image) {
      content += `![${title}](${imageUrl})\n\n`
    }

    // Add description
    if (description) {
      content += `${description}\n\n`
    }

    // Add metadata
    const metaInfo = []
    if (date) metaInfo.push(`**Published:** ${date}`)
    if (author) metaInfo.push(`**Author:** ${author}`)
    if (tags.length > 0) metaInfo.push(`**Tags:** ${tags.join(', ')}`)

    if (metaInfo.length > 0) {
      content += `${metaInfo.join(' | ')}\n\n---\n\n`
    }

    // Add excerpt
    if (excerpt) {
      content += `${excerpt}\n\n---\n\n`
    }

    // Add link back to docs
    content += `📚 **[Continue reading the full tutorial →](${postUrl})**`

    return content
  }

  // Search for existing topic by URL using Discourse search API
  const searchExistingTopic = async url => {
    try {
      // Use Discourse search API to find topics with matching embed_url
      const searchQuery = encodeURIComponent(url)
      const response = await fetch(`${DISCOURSE_URL}/search.json?q=${searchQuery}`, {
        method: 'GET',
        headers: {
          'Api-Key': DISCOURSE_API_KEY,
          'Api-Username': DISCOURSE_API_USERNAME,
          'Content-Type': 'application/json',
        },
        mode: 'cors',
      })

      if (response.ok) {
        const data = await response.json()
        // Look for topics that might match our URL
        const matchingTopic = data.topics?.find(
          topic => topic.title?.includes(metadata.title) || topic.excerpt?.includes(url)
        )
        return matchingTopic?.id || null
      }
      return null
    } catch (e) {
      console.warn('Failed to search for existing topic:', e)
      return null
    }
  }

  // Create new Discourse topic
  const createDiscourseTopic = async () => {
    if (!DISCOURSE_API_KEY) {
      throw new Error('Discourse API key not configured')
    }

    const excerpt = extractContentExcerpt()
    const content = formatDiscourseContent(excerpt)

    const response = await fetch(`${DISCOURSE_URL}/posts.json`, {
      method: 'POST',
      headers: {
        'Api-Key': DISCOURSE_API_KEY,
        'Api-Username': DISCOURSE_API_USERNAME,
        'Content-Type': 'application/json',
      },
      mode: 'cors',
      body: JSON.stringify({
        title: metadata.title || 'Tutorial Discussion',
        raw: content,
        category: DISCOURSE_CATEGORY_ID,
        tags: metadata.tags || [],
        embed_url: postUrl,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.errors?.[0] || `HTTP ${response.status}`)
    }

    const data = await response.json()
    return data.topic_id
  }

  // Load or create Discourse embed
  const loadDiscourseEmbed = finalTopicId => {
    // Clean up any existing embed
    const existingScript = document.querySelector('script[src*="embed.js"]')
    if (existingScript) {
      existingScript.remove()
    }

    const existingComments = document.getElementById('discourse-comments')
    if (existingComments) {
      existingComments.innerHTML = ''
    }

    // Set up Discourse embed configuration
    window.DiscourseEmbed = {
      discourseUrl: `${DISCOURSE_URL}/`,
      discourseEmbedUrl: postUrl,
      ...(finalTopicId && { topicId: finalTopicId }),
    }

    // Load embed script
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = `${DISCOURSE_URL}/javascripts/embed.js`

    const targetElement =
      document.getElementsByTagName('head')[0] || document.getElementsByTagName('body')[0]
    targetElement.appendChild(script)
  }

  // Main effect to handle topic creation/loading
  useEffect(() => {
    if (topicId) {
      // Topic ID provided in frontmatter, use it directly
      loadDiscourseEmbed(topicId)
      return
    }

    // No topic ID, need to search or create
    const handleTopicCreation = async () => {
      setLoading(true)
      setError(null)

      try {
        // Check if API key is configured
        if (!DISCOURSE_API_KEY) {
          console.log('No Discourse API key configured, using basic embed')
          loadDiscourseEmbed()
          return
        }

        console.log('Searching for existing topic...')
        // First, search for existing topic
        let foundTopicId = await searchExistingTopic(postUrl)

        if (!foundTopicId) {
          console.log('No existing topic found, creating new one...')
          // No existing topic found, create new one
          foundTopicId = await createDiscourseTopic()
          console.log('Created topic with ID:', foundTopicId)
        } else {
          console.log('Found existing topic with ID:', foundTopicId)
        }

        setTopicId(foundTopicId)
        loadDiscourseEmbed(foundTopicId)
      } catch (e) {
        console.error('Discourse integration error:', e)

        // Check if it's a CORS or authentication error
        if (e.message.includes('CORS') || e.message.includes('Failed to fetch')) {
          setError('CORS configuration needed - check Discourse admin settings')
        } else {
          setError(e.message)
        }

        // Fallback to basic embed without topic creation
        console.log('Falling back to basic embed...')
        loadDiscourseEmbed()
      } finally {
        setLoading(false)
      }
    }

    // Add small delay to ensure DOM is ready
    const timer = setTimeout(handleTopicCreation, 100)
    return () => clearTimeout(timer)
  }, [postUrl, topicId])

  if (error && !DISCOURSE_API_KEY) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <p>💬 Discussion integration not configured.</p>
        <p style={{ fontSize: '0.9em' }}>
          To enable automatic topic creation, configure Discourse API credentials.
        </p>
      </div>
    )
  }

  return (
    <>
      <meta name="discourse-username" content="system" />
      {loading && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
          <p>🔄 Loading discussion...</p>
        </div>
      )}
      {error && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#e74c3c' }}>
          <p>⚠️ Failed to load discussion: {error}</p>
          <p style={{ fontSize: '0.9em', color: '#666' }}>
            Comments may still appear below if the topic exists.
          </p>
        </div>
      )}
      <div id="discourse-comments" />
    </>
  )
}
