import os
import time
import openai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GROQ_API_KEY")
api_base = os.getenv("GROQ_API_BASE")

client = openai.OpenAI(
    api_key=api_key,
    base_url=api_base,
)

async def get_llm_response(prompt):
    try:
        start_time = time.time()

        response = client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            stream=True
        )
        final_response = ""
        print("LLM Response:")
        for chunk in response:
            delta = chunk.choices[0].delta
            content_piece = getattr(delta, "content", None)
            if content_piece:
                print(content_piece, end='', flush=True)
                final_response += content_piece
                yield content_piece
        total_time = time.time() - start_time
        print(f"\nResponse time: {total_time:.2f} seconds")
        

    except Exception as e:
        print(f" Error fetching LLM response: {e}")
        return